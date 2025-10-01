import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
import { PublicKey } from "@solana/web3.js";
import { LiquidityBookServices, MODE, PoolMetadata } from "@saros-finance/dlmm-sdk";
import { PrismaClient, Status } from "@prisma/client";
import { calculatepositon, monitor } from "./monitor";
import { generateWallet, encryptPrivateKey } from "./auth";
import { handleSwapCommand, handleSwapFlow } from "./swapHandler";
import bs58 from "bs58";
import axios from "axios";
dotenv.config();
const prisma=new PrismaClient();
const bot = new Telegraf(process.env.TELEGRAM_API || "");
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const userStates = new Map();
const DEFAULT_KEYBOARD = Markup.inlineKeyboard([
    [Markup.button.callback("📊 Track Wallet Positions", "track_positions")],
    [Markup.button.callback("🔐 Create New Wallet", "create_wallet")],
    [Markup.button.callback("🔄 Swap Tokens", "swap_tokens")]
]);
type Postion={
 mint:string,
 Lower:string,
Upper:string
}
bot.start(async (ctx) => {                                                                                                              
    await ctx.reply("Welcome to the Saros DLMM Bot! 🚀\n\nChoose an option to begin:", {
        ...DEFAULT_KEYBOARD
    });                                                                                                                                                                                                         
});
bot.action("track_positions", async (ctx) => {
    userStates.set(ctx.from.id, { step: 'awaiting_pool' });
    await ctx.reply("🏊 Please enter the pool address you want to analyze:");
});

bot.action("swap_tokens", async (ctx) => {
    await handleSwapCommand(ctx, userStates);
});

bot.action("create_wallet", async (ctx) => {
    try {
        const userId = ctx.from.id;
        
        // Check if user already has a wallet
        const existingUser = await prisma.user.findUnique({
            where: { telegram_id: userId.toString() }
        });
        
        if (existingUser && existingUser.encrypted_private_key) {
            await ctx.reply(`⚠️ You already have a wallet!\n\n🔑 **Your Public Key:**\n\`${existingUser.public_key}\`\n\n⚠️ For security reasons, we cannot show your private key again. Make sure you saved it previously!`, 
                { parse_mode: 'Markdown' });
            return;
        }
        
        // Generate new wallet
        const wallet = generateWallet();
        const { encrypted, iv } = encryptPrivateKey(wallet.secretKey);
        
        // Save to database
        if (existingUser) {
            // Update existing user with wallet
            await prisma.user.update({
                where: { telegram_id: userId.toString() },
                data: {
                    public_key: wallet.publicKey,
                    encrypted_private_key: encrypted,
                    encryption_iv: iv
                }
            });
        } else {
            // Create new user with wallet
            await prisma.user.create({
                data: {
                    telegram_id: userId.toString(),
                    public_key: wallet.publicKey,
                    encrypted_private_key: encrypted,
                    encryption_iv: iv
                }
            });
        }
        
        // Convert secret key to base58 for display
        const privateKeyBase58 = bs58.encode(wallet.secretKey);
        
        await ctx.reply(
            `✅ **Wallet Created Successfully!**\n\n` +
            `🔑 **Public Key (Share this):**\n\`${wallet.publicKey}\`\n\n` +
            `🔐 **Private Key (NEVER share this!):**\n\`${privateKeyBase58}\`\n\n` +
            `⚠️ **IMPORTANT:**\n` +
            `• Save your private key in a secure location\n` +
            `• Never share it with anyone\n` +
            `• This is the ONLY time we'll show your private key\n` +
            `• You can import this wallet into Phantom, Solflare, etc.`,
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        console.error("Error creating wallet:", error);
        await ctx.reply("❌ An error occurred while creating your wallet. Please try again.");
    }
});
bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    const message = ctx.message.text;
    const userState = userStates.get(userId);
    if (!userState) {
        await ctx.reply("Please use the menu buttons to start! 👆", {
            ...DEFAULT_KEYBOARD
        });
        return;
    }
    
    // Handle swap flow
    if (userState.swapState) {
        await handleSwapFlow(ctx, message, userId, userStates);
        return;
    }
     try {
         const liquidityBookService = new LiquidityBookServices({
             mode: MODE.MAINNET,
             options: {
                 rpcUrl: RPC_URL,
             },
         });
        if (userState.step === 'awaiting_pool') {
            try {
                new PublicKey(message);
            } catch (error) {
                await ctx.reply("❌ Invalid pool address. Please enter a valid Solana public key:");
                return;
            }
            userState.pool = message;
            userState.step = 'awaiting_wallet';
            await ctx.reply(`✅ Pool address saved: ${message}\n\n📝 Now, please enter the wallet public key to check for positions:`);
        } else if (userState.step === 'awaiting_wallet') {
            const poolAddress = userState.pool;
            const walletAddress = message;
            try {
                new PublicKey(walletAddress);
            } catch (error) {
                await ctx.reply("❌ Invalid wallet address. Please enter a valid Solana public key:");
                return;
            }
            await ctx.reply(`⏳ Searching for positions for wallet ${walletAddress} in pool ${poolAddress}...`);
            const positions = await liquidityBookService.getUserPositions({
                payer: new PublicKey(walletAddress),
                pair: new PublicKey(poolAddress)
            });
            if (positions.length === 0) {
                await ctx.reply(`🤷 No positions found for wallet \`${walletAddress}\` in pool \`${poolAddress}\`.`, { parse_mode: 'Markdown' });
                userStates.delete(userId);
                return;
            }
            let response = `🎯 **Analysis Complete**\n\n`;
            response += `📍 **Pool Address:** \`${poolAddress}\`\n`;
            response += `👤 **Wallet:** \`${walletAddress}\`\n`;
            response += `📊 **Total Positions Found:** ${positions.length}\n\n`;
            const positionData = positions.map(position => ({
                mint: position.positionMint.toString(),
                lowerId: position.lowerBinId.toString(),
                upperId: position.upperBinId.toString(),
                Previous:0.0,
                Market:poolAddress,
                Status: Status.Active
            }));
            positions.forEach((position, index) => {
                response += `*Position ${index + 1}*\n`;
                response += ` •  *Mint:* \`${position.positionMint}\`\n`;
                response += ` •  *Lower Bin ID:* ${position.lowerBinId}\n`;
                response += ` •  *Upper Bin ID:* ${position.upperBinId}\n\n`;
            });
            await prisma.user.create({
                data: {
                    telegram_id: userId.toString(),
                    public_key: walletAddress,
                    positions: {
                        create: positionData
                    }
                }
            })
            await ctx.reply(response, { parse_mode: 'Markdown' });
            userStates.delete(userId); // Clean up state after completion
        }

    } catch (error) {
        console.error("Error:", error);
        await ctx.reply("❌ An unexpected error occurred. Please try again.");
        userStates.delete(userId); // Clean up state on error
    }
});

async function temp(){
    const liquidityBookService = new LiquidityBookServices({
        mode: MODE.MAINNET,
    });
    const publickey=new PublicKey("HvFfbbDXggmz7UfE21rdL8x6RBX5RpEPvw7kUJVkCk9A");
    // const data= await liquidityBookService.getPositionAccount(publickey);
    // console.log(data);
    const pairInfo = await liquidityBookService.getPairAccount(new PublicKey("9P3N4QxjMumpTNNdvaNNskXu2t7VHMMXtePQB72kkSAk"));
            const activeBin = pairInfo.activeId;
        const pool=await liquidityBookService.fetchPoolAddresses();
        // console.log(pool);    
//         const pul= await   liquidityBookService.
//    console.log(pul);
    //  const poolPositions = await liquidityBookService.getUserPositions({
    //     payer:publickey,
    //     pair: new PublicKey("Cpjn7PkhKs5VMJ1YAb2ebS5AEGXUgRsxQHt38U8aefK3") 
    // });
    // console.log(poolPositions[0].position)
    const result = await liquidityBookService.getPositionAccount(new PublicKey("GhYac22LPuLizrHkWJcyZ7ZAQKNEXjpH2Jw5dD98BvAY"));
    const poolinfor:PoolMetadata=await liquidityBookService.fetchPoolMetadata(pool[1]);  
       const poolionf=await liquidityBookService.getPairAccount(new PublicKey(poolinfor.poolAddress));
       console.log(liquidityBookService.getDexName());
       console.log(poolionf.tokenMintX);
       console.log(poolionf.tokenMintX);
    const response = await axios.get(`https://lite-api.jup.ag/price/v3?ids=${poolinfor.poolAddress}`);
    console.log(response.data);
// const tokenData = response.data.data[poolionf.tokenMintX];
// console.log(tokenData.symbol); // Token symbol
// console.log(tokenData.name);

    console.log(result);
    // console.log(poolPositions);
    // console.log(pairInfo);
    //8377610
}
// monitor();
// Example usage:
// calculatepositon(
//     "GhYac22LPuLizrHkWJcyZ7ZAQKNEXjpH2Jw5dD98BvAY", // position address
//     "Cpjn7PkhKs5VMJ1YAb2ebS5AEGXUgRsxQHt38U8aefK3", // pair address
//     "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", // token A mint
//     "CtzPWv73Sn1dMGVU3ZtLv9yWSyUAanBni19YWDaznnkn"  // token B mint
// ).then(result => console.log(result));
temp();
bot.launch();
console.log("Bot is running...");