import { PrismaClient } from "@prisma/client"
import { LiquidityBookServices, MODE } from "@saros-finance/dlmm-sdk";
import { PublicKey } from "@solana/web3.js";
import axios from "axios";
import { Telegraf } from "telegraf";

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
            include: { user: { select: { telegram_id: true, public_key: true, id: true } } }
        });

        console.log(`Found ${positions.length} positions to monitor`)

        const uniqueCombos = new Map<string, { userId: string; wallet: string; market: string }>();
        for (const p of positions) {
            if (!p.user?.public_key) continue;
            const key = `${p.user.id}:${p.Market}`;
            if (!uniqueCombos.has(key)) {
                uniqueCombos.set(key, { userId: p.user.id, wallet: p.user.public_key, market: p.Market });
            }
        }

        for (const { userId, wallet, market } of uniqueCombos.values()) {
            try {
                const onchainPositions = await liquidityBookService.getUserPositions({
                    payer: new PublicKey(wallet),
                    pair: new PublicKey(market)
                });

                if (!onchainPositions?.length) continue;

                const pairInfo = await liquidityBookService.getPairAccount(new PublicKey(market));
                const poolMetadata = await liquidityBookService.fetchPoolMetadata(market);
                const tokenXMint = pairInfo.tokenMintX.toString();
                const tokenYMint = pairInfo.tokenMintY.toString();
                const tokenXDecimals = poolMetadata.extra.tokenBaseDecimal;
                const tokenYDecimals = poolMetadata.extra.tokenQuoteDecimal;

                const priceResponse = await axios.get(
                    `https://lite-api.jup.ag/price/v3?ids=${tokenXMint},${tokenYMint}`
                );
                const tokenXPrice = priceResponse.data.data?.[tokenXMint]?.price || 0;
                const tokenYPrice = priceResponse.data.data?.[tokenYMint]?.price || 0;

                const existing = await prisma.position.findMany({
                    where: { userId, Market: market },
                    select: { mint: true }
                });
                const existingMints = new Set(existing.map(e => e.mint));

                for (const ocp of onchainPositions) {
                    const mintStr = ocp.positionMint.toString();
                    if (existingMints.has(mintStr)) continue;

                    const reserveInfo = await liquidityBookService.getBinsReserveInformation({
                        position: new PublicKey(ocp.position),
                        pair: new PublicKey(market),
                        payer: new PublicKey(wallet)
                    });

                    let totalTokenX = 0;
                    let totalTokenY = 0;
                    reserveInfo.forEach(bin => {
                        totalTokenX += Number(bin.reserveX);
                        totalTokenY += Number(bin.reserveY);
                    });

                    const initA = totalTokenX / Math.pow(10, tokenXDecimals);
                    const initB = totalTokenY / Math.pow(10, tokenYDecimals);

                    await prisma.position.create({
                        data: {
                            userId,
                            mint: mintStr,
                            lowerId: ocp.lowerBinId.toString(),
                            upperId: ocp.upperBinId.toString(),
                            Market: market,
                            Status: 'Active',
                            Previous: 0.0,
                            initialTokenAAmount: initA,
                            initialTokenBAmount: initB,
                            initialTokenAPriceUSD: tokenXPrice,
                            initialTokenBPriceUSD: tokenYPrice,
                            lastILWarningPercent: 0.0
                        }
                    });
                    console.log(`Synced new position ${mintStr} for user ${userId} in market ${market}`);
                }
            } catch (e) {
                console.error(`Sync error for user ${userId} market ${market}:`, e);
            }
        }

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
                
                const poolPositions = await liquidityBookService.getUserPositions({
                    payer: new PublicKey(userPublicKey),
                    pair: new PublicKey(marketAddress)                                                                                                              
                });
                
                const matchingPosition = poolPositions.find(
                    p => p.positionMint.toString() === position.mint
                );
                
                if (!matchingPosition) {
                    console.log(`Position ${position.mint} not found in current user positions`);
                    continue;
                }

                const positionAddress = new PublicKey(matchingPosition.position);
                
                const reserveInfo = await liquidityBookService.getBinsReserveInformation({
                    position: positionAddress,
                    pair: new PublicKey(marketAddress),
                    payer: new PublicKey(userPublicKey)
                });
                
                let totalTokenX = 0;
                let totalTokenY = 0;
                
                reserveInfo.forEach(bin => {
                    totalTokenX += Number(bin.reserveX);
                    totalTokenY += Number(bin.reserveY);
                });
                
                const tokenXMint = pairInfo.tokenMintX.toString();
                const tokenYMint = pairInfo.tokenMintY.toString();
                
                const priceResponse = await axios.get(
                    `https://lite-api.jup.ag/price/v3?ids=${tokenXMint},${tokenYMint}`
                );
                
                const tokenXPrice = priceResponse.data.data?.[tokenXMint]?.price || 0;
                const tokenYPrice = priceResponse.data.data?.[tokenYMint]?.price || 0;
                
                const poolMetadata = await liquidityBookService.fetchPoolMetadata(marketAddress);
                const tokenXDecimals = poolMetadata.extra.tokenBaseDecimal;
                const tokenYDecimals = poolMetadata.extra.tokenQuoteDecimal;
                
                const adjustedTokenX = totalTokenX / Math.pow(10, tokenXDecimals);
                const adjustedTokenY = totalTokenY / Math.pow(10, tokenYDecimals);
                
                const currentValue = (adjustedTokenX * tokenXPrice) + (adjustedTokenY * tokenYPrice);
                
                console.log(`Position value: $${currentValue.toFixed(2)} (Token X: ${adjustedTokenX.toFixed(4)}, Token Y: ${adjustedTokenY.toFixed(4)})`);
                
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
                        
                        await prisma.position.update({
                            where: { id: position.id },
                            data: { Previous: currentValue }
                        });
                    }
                } else {
                    console.log(`Setting initial value: $${currentValue.toFixed(2)}`);
                    await prisma.position.update({
                        where: { id: position.id },
                        data: { Previous: currentValue }
                    });
                }
                
                const IL_THRESHOLD = -5;
                const IL_NOTIFICATION_STEP = 2.5;
                
                const {
                    initialTokenAAmount,
                    initialTokenBAmount,
                    initialTokenAPriceUSD,
                    initialTokenBPriceUSD,
                    lastILWarningPercent
                } = position;
                
                if (initialTokenAAmount > 0 || initialTokenBAmount > 0) {
                    const valueIfHeld = (initialTokenAAmount * tokenXPrice) + (initialTokenBAmount * tokenYPrice);
                    
                    let impermanentLossPercentage = 0;
                    if (valueIfHeld > 0) {
                        impermanentLossPercentage = ((currentValue - valueIfHeld) / valueIfHeld) * 100;
                    }
                    
                    console.log(`IL Check: Current: $${currentValue.toFixed(2)}, HODL: $${valueIfHeld.toFixed(2)}, IL: ${impermanentLossPercentage.toFixed(2)}%`);
                    
                    if (impermanentLossPercentage <= IL_THRESHOLD) {
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
                            
                            await prisma.position.update({
                                where: { id: position.id },
                                data: { lastILWarningPercent: impermanentLossPercentage }
                            });
                        }
                    } else if (impermanentLossPercentage > 0 && lastILWarningPercent < 0) {
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
    }, 900000) // 15 minutes
    
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
    
    const reserves = await liquidityBookService.getBinsReserveInformation({
        position: new PublicKey(positionAddress),
        pair: new PublicKey(pairAddress),
        payer: new PublicKey("11111111111111111111111111111111")
    });
    
    let totalTokenA = 0;
    let totalTokenB = 0;
    
    reserves.forEach(reserve => {
        totalTokenA += Number(reserve.reserveX) || 0;
        totalTokenB += Number(reserve.reserveY) || 0;
    });
    
    console.log(`Token A amount: ${totalTokenA}`);
    console.log(`Token B amount: ${totalTokenB}`);
    
    const response = await axios.get(`https://lite-api.jup.ag/price/v3?ids=${tokenAMint},${tokenBMint}`);
    const data = response.data;
    
    const tokenAPrice = data[tokenAMint]?.usdPrice || 0;
    const tokenBPrice = data[tokenBMint]?.usdPrice || 0;
    
    const totalValue = (totalTokenA * tokenAPrice) + (totalTokenB * tokenBPrice);
    
    return {
        tokenA: { amount: totalTokenA, price: tokenAPrice, value: totalTokenA * tokenAPrice },
        tokenB: { amount: totalTokenB, price: tokenBPrice, value: totalTokenB * tokenBPrice },
        totalValue
    };
}
