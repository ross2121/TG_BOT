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
                
            } catch (error) {
                console.error(`Error checking position ${position.mint}:`, error);
            }
        }
        
        console.log("Monitor check complete");
    },9000)
    
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