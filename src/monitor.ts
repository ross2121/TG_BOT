import { PrismaClient } from "@prisma/client"
import { LiquidityBookServices, MODE } from "@saros-finance/dlmm-sdk";
import { PublicKey } from "@solana/web3.js";
import axios from "axios";
import { Telegraf } from "telegraf";

// Reuse singletons to avoid opening too many DB and network connections
const prisma = new PrismaClient();
const bot = new Telegraf(process.env.TELEGRAM_API || "");
const liquidityBookService = new LiquidityBookServices({
    mode: MODE.MAINNET,
    options: {
        rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
    },
});

export const monitor = async () => {
    setInterval(async()=>{
        console.log("Starting position monitor...");

        const positions = await prisma.position.findMany({
            include: { user: { select: { telegram_id: true, public_key: true } } }
        });
        console.log(`Found ${positions.length} positions to monitor`)
        for (let i = 0; i < positions.length; i++) {
            const position = positions[i];
            const marketAddress = position.Market;
            try {
                console.log(`Checking position ${i + 1}: Market ${marketAddress}`);
            
                const pairInfo = await liquidityBookService.getPairAccount(new PublicKey(marketAddress));
                const activeBin = pairInfo.activeId;
                
                const lowerBinId = parseInt(position.lowerId);
                const upperBinId = parseInt(position.upperId);
                
                console.log(`Active bin: ${activeBin}, Position range: ${lowerBinId} - ${upperBinId}`);
                
                // Check if position is out of range
                const isOutOfRange = activeBin < lowerBinId || activeBin > upperBinId;
                if (isOutOfRange) {
                    console.log(`⚠️  Position ${position.mint} is out of range!`);
                    const chatId = position.user?.telegram_id;
                    if (chatId) {
                        const text = `⚠️ Position out of range\n\n` +
                            `• Market: ${marketAddress}\n` +
                            `• Position Mint: ${position.mint}\n` +
                            `• Active Bin: ${activeBin}\n` +
                            `• Range: ${lowerBinId} - ${upperBinId}`;
                        try { await bot.telegram.sendMessage(chatId, text); } catch {}
                    }
                } else {
                    console.log(`✅ Position ${position.mint} is in range`);
                }
                
                const userPublicKey = position.user?.public_key;
                
                if (!userPublicKey) {
                    console.log(`No public key found for position ${position.mint}`);
                    continue;
                }
                
                // Get all user positions for this pair to find the actual position account
                const poolPositions = await liquidityBookService.getUserPositions({
                    payer: new PublicKey(userPublicKey),
                    pair: new PublicKey(marketAddress)
                });
                
                // Find the matching position by mint address
                const matchingPosition = poolPositions.find(
                    p => p.positionMint.toString() === position.mint
                );
                
                if (!matchingPosition) {
                    console.log(`Position ${position.mint} not found in current user positions`);
                    continue;
                }
                
                // Use the actual position account address, not the mint
                const positionAddress = new PublicKey(matchingPosition.position);
                
                // Get token amounts from reserves
                const reserveInfo = await liquidityBookService.getBinsReserveInformation({
                    position: positionAddress,
                    pair: new PublicKey(marketAddress),
                    payer: new PublicKey(userPublicKey)
                });
                // Calculate total token amounts
                let totalTokenX = 0;
                let totalTokenY = 0;
                
                reserveInfo.forEach(bin => {
                    totalTokenX += Number(bin.reserveX);
                    totalTokenY += Number(bin.reserveY);
                });
                
                // Get token prices from Jupiter API
                const tokenXMint = pairInfo.tokenMintX.toString();
                const tokenYMint = pairInfo.tokenMintY.toString();
                
                const priceResponse = await axios.get(
                    `https://api.jup.ag/price/v3?ids=${tokenXMint},${tokenYMint}`
                );
                
                const tokenXPrice = priceResponse.data.data?.[tokenXMint]?.price || 0;
                const tokenYPrice = priceResponse.data.data?.[tokenYMint]?.price || 0;
                
                // Get token decimals from pair info
                const poolMetadata = await liquidityBookService.fetchPoolMetadata(marketAddress);
                const tokenXDecimals = poolMetadata.extra.tokenBaseDecimal;
                const tokenYDecimals = poolMetadata.extra.tokenQuoteDecimal;
                
                // Adjust for decimals
                const adjustedTokenX = totalTokenX / Math.pow(10, tokenXDecimals);
                const adjustedTokenY = totalTokenY / Math.pow(10, tokenYDecimals);
                
                // Calculate total USD value
                const currentValue = (adjustedTokenX * tokenXPrice) + (adjustedTokenY * tokenYPrice);
                
                console.log(`Position value: $${currentValue.toFixed(2)} (Token X: ${adjustedTokenX.toFixed(4)}, Token Y: ${adjustedTokenY.toFixed(4)})`);
                
                // Check if value changed by 10% or more
                const previousValue = position.Previous;
                
                if (previousValue > 0) {
                    const percentageChange = ((currentValue - previousValue) / previousValue) * 100;
                    
                    if (Math.abs(percentageChange) >= 10) {
                        console.log(`🚨 Value change detected: ${percentageChange.toFixed(2)}%`);
                        
                        const chatId = position.user?.telegram_id;
                        if (chatId) {
                            const emoji = percentageChange > 0 ? "📈" : "📉";
                            const direction = percentageChange > 0 ? "increased" : "decreased";
                            
                            const text = `${emoji} Position Value Alert!\n\n` +
                                `Your position has ${direction} by ${Math.abs(percentageChange).toFixed(2)}%\n\n` +
                                `• Position: ${position.mint}\n` +
                                `• Previous Value: $${previousValue.toFixed(2)}\n` +
                                `• Current Value: $${currentValue.toFixed(2)}\n` +
                                `• Token X: ${adjustedTokenX.toFixed(4)} @ $${tokenXPrice.toFixed(4)}\n` +
                                `• Token Y: ${adjustedTokenY.toFixed(4)} @ $${tokenYPrice.toFixed(4)}`;
                            
                            try {
                                await bot.telegram.sendMessage(chatId, text);
                            } catch (error) {
                                console.error(`Failed to send alert to ${chatId}:`, error);
                            }
                        }
                        
                        // Update the Previous value in database
                        await prisma.position.update({
                            where: { id: position.id },
                            data: { Previous: currentValue }
                        });
                    }
                } else {
                    // First time monitoring, just set the current value
                    console.log(`Setting initial value: $${currentValue.toFixed(2)}`);
                    await prisma.position.update({
                        where: { id: position.id },
                        data: { Previous: currentValue }
                    });
                }
                
                // ========== IMPERMANENT LOSS CALCULATION ==========
                const IL_THRESHOLD = -5; // 5% loss threshold
                const IL_NOTIFICATION_STEP = 2.5; // Only notify every 2.5% additional loss
                
                // Get initial data from database
                const {
                    initialTokenAAmount,
                    initialTokenBAmount,
                    initialTokenAPriceUSD,
                    initialTokenBPriceUSD,
                    lastILWarningPercent
                } = position;
                
                // Only calculate IL if we have initial data
                if (initialTokenAAmount > 0 || initialTokenBAmount > 0) {
                    // Calculate "Value if Held" (HODL value)
                    const valueIfHeld = (initialTokenAAmount * tokenXPrice) + (initialTokenBAmount * tokenYPrice);
                    
                    // Calculate Impermanent Loss Percentage
                    let impermanentLossPercentage = 0;
                    if (valueIfHeld > 0) {
                        impermanentLossPercentage = ((currentValue - valueIfHeld) / valueIfHeld) * 100;
                    }
                    
                    console.log(`IL Check: Current: $${currentValue.toFixed(2)}, HODL: $${valueIfHeld.toFixed(2)}, IL: ${impermanentLossPercentage.toFixed(2)}%`);
                    
                    // Check if IL threshold is crossed
                    if (impermanentLossPercentage <= IL_THRESHOLD) {
                        // Check if this is a new warning or IL got significantly worse
                        const ilDifference = Math.abs(impermanentLossPercentage - lastILWarningPercent);
                        const shouldNotify = lastILWarningPercent === 0 || ilDifference >= IL_NOTIFICATION_STEP;
                        
                        if (shouldNotify) {
                            console.log(`🚨 IL Warning: ${impermanentLossPercentage.toFixed(2)}%`);
                            
                            const chatId = position.user?.telegram_id;
                            if (chatId) {
                                const emoji = impermanentLossPercentage < -10 ? "🔴" : "⚠️";
                                const ilAbsolute = Math.abs(impermanentLossPercentage);
                                
                                const text = `${emoji} **Impermanent Loss Alert!**\n\n` +
                                    `Your position has an IL of **${ilAbsolute.toFixed(2)}%** compared to holding.\n\n` +
                                    `📊 **Position Details:**\n` +
                                    `• Position: ${position.mint}\n` +
                                    `• Current Value: $${currentValue.toFixed(2)}\n` +
                                    `• HODL Value: $${valueIfHeld.toFixed(2)}\n` +
                                    `• Difference: $${(currentValue - valueIfHeld).toFixed(2)}\n\n` +
                                    `💰 **Current Position:**\n` +
                                    `• Token X: ${adjustedTokenX.toFixed(4)} @ $${tokenXPrice.toFixed(4)}\n` +
                                    `• Token Y: ${adjustedTokenY.toFixed(4)} @ $${tokenYPrice.toFixed(4)}\n\n` +
                                    `🔒 **Initial (HODL):**\n` +
                                    `• Token X: ${initialTokenAAmount.toFixed(4)} @ $${initialTokenAPriceUSD.toFixed(4)}\n` +
                                    `• Token Y: ${initialTokenBAmount.toFixed(4)} @ $${initialTokenBPriceUSD.toFixed(4)}`;
                                
                                try {
                                    await bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                                } catch (error) {
                                    console.error(`Failed to send IL alert to ${chatId}:`, error);
                                }
                            }
                            
                            // Update the last IL warning percentage
                            await prisma.position.update({
                                where: { id: position.id },
                                data: { lastILWarningPercent: impermanentLossPercentage }
                            });
                        }
                    } else if (impermanentLossPercentage > 0 && lastILWarningPercent < 0) {
                        // IL has recovered to positive (user is now ahead)
                        console.log(`✅ IL Recovered: ${impermanentLossPercentage.toFixed(2)}%`);
                        
                        const chatId = position.user?.telegram_id;
                        if (chatId) {
                            const text = `✅ **Good News!**\n\n` +
                                `Your position IL has recovered!\n\n` +
                                `• Current Value: $${currentValue.toFixed(2)}\n` +
                                `• HODL Value: $${valueIfHeld.toFixed(2)}\n` +
                                `• You're ahead by: ${impermanentLossPercentage.toFixed(2)}%`;
                            
                            try {
                                await bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                            } catch (error) {
                                console.error(`Failed to send IL recovery alert to ${chatId}:`, error);
                            }
                        }
                        
                        // Reset the warning tracker
                        await prisma.position.update({
                            where: { id: position.id },
                            data: { lastILWarningPercent: 0 }
                        });
                    }
                }
                
            } catch (error) {
                console.error(`Error checking position ${position.mint}:`, error);
            }
        }
        
        console.log("Monitor check complete");
    },900000) // 15 minutes
    
}

export const calculatepositon=async(
    positionAddress: string,
    pairAddress: string,
    tokenAMint: string,
    tokenBMint: string
)=>{
    const liquidityBookService = new LiquidityBookServices({
        mode: MODE.MAINNET,
        options: {
            rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
        },
    });
    
    // Get the reserves (token amounts) for the position
    const reserves = await liquidityBookService.getBinsReserveInformation({
        position: new PublicKey(positionAddress),
        pair: new PublicKey(pairAddress),
        payer: new PublicKey("11111111111111111111111111111111") // Dummy payer for read-only
    });
    
    // Sum up all reserves across all bins
    let totalTokenA = 0;
    let totalTokenB = 0;
    
    reserves.forEach(reserve => {
        totalTokenA += Number(reserve.reserveX) || 0;
        totalTokenB += Number(reserve.reserveY) || 0;
    });
    
    console.log(`Token A amount: ${totalTokenA}`);
    console.log(`Token B amount: ${totalTokenB}`);
    
    // Get USD prices from Jupiter
    const response = await axios.get(`https://lite-api.jup.ag/price/v3?ids=${tokenAMint},${tokenBMint}`);
    const data = response.data;
    
    const tokenAPrice = data[tokenAMint]?.usdPrice || 0;
    const tokenBPrice = data[tokenBMint]?.usdPrice || 0;
    
    // Calculate total USD value
    const totalValue = (totalTokenA * tokenAPrice) + (totalTokenB * tokenBPrice);
    
    return {
        tokenA: { amount: totalTokenA, price: tokenAPrice, value: totalTokenA * tokenAPrice },
        tokenB: { amount: totalTokenB, price: tokenBPrice, value: totalTokenB * tokenBPrice },
        totalValue
    };
}