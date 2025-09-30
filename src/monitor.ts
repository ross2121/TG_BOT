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
export const calculatepositon=async(tokenA:string,tokenB:string,amounta:number,amountb:number)=>{
const response=await axios.get(`https://lite-api.jup.ag/price/v3?ids=${tokenA},${tokenB}`);
const data = response.data;

const tokenAPrice = data[tokenA]?.usdPrice;
const tokenBPrice = data[tokenB]?.usdPrice;

const price=(amounta*tokenAPrice)+(amountb*tokenBPrice);

return price;
}