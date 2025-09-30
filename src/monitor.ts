import { PrismaClient } from "@prisma/client"
import { LiquidityBookServices, MODE } from "@saros-finance/dlmm-sdk";
import { PublicKey } from "@solana/web3.js";
import axios from "axios";
import { Telegraf } from "telegraf";

export const monitor = async () => {
    setInterval(async()=>{
        const prisma = new PrismaClient();
        console.log("Starting position monitor...");
        const bot = new Telegraf(process.env.TELEGRAM_API || "");
        const liquidityBookService = new LiquidityBookServices({
            mode: MODE.MAINNET,
            options: {
                rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
            },
        });

        const positions = await prisma.position.findMany({
            include: { user: { select: { telegram_id: true } } }
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
                
                if (activeBin < lowerBinId || activeBin > upperBinId) {
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
                
            } catch (error) {
                console.error(`Error checking position ${position.mint}:`, error);
            }
        }
        
        console.log("Monitor check complete");
    },900000)
    
}

export const PostionMonitor= async () => {
    setInterval(async()=>{
        const prisma = new PrismaClient();
        console.log("Starting position monitor...");
        const bot = new Telegraf(process.env.TELEGRAM_API || "");
        const liquidityBookService = new LiquidityBookServices({
            mode: MODE.MAINNET,
            options: {
                rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
            },
        });
        const positions = await prisma.position.findMany({
            include: { user: { select: { telegram_id: true } } }
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
                
                if (activeBin < lowerBinId || activeBin > upperBinId) {
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
                
            } catch (error) {
                console.error(`Error checking position ${position.mint}:`, error);
            }
        }
        
        console.log("Monitor check complete");
    },900000)
    
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
        totalTokenA += reserve.reserveX;
        totalTokenB += parseInt(reserve.reserveY)||0;
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