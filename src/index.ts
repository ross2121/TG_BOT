import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
import { PublicKey } from "@solana/web3.js";
import { LiquidityBookServices, MODE } from "@saros-finance/dlmm-sdk";
import { PrismaClient, Status } from "@prisma/client";
import { monitor } from "./monitor";
dotenv.config();
const prisma=new PrismaClient();
const bot = new Telegraf(process.env.TELEGRAM_API || "");
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const userStates = new Map();
const DEFAULT_KEYBOARD = Markup.inlineKeyboard([
    [Markup.button.callback("📊 Track Wallet Positions", "track_positions")]
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
//         const pul= await   liquidityBookService.
//    console.log(pul);
     const poolPositions = await liquidityBookService.getUserPositions({
        payer:publickey,
        pair: new PublicKey("Cpjn7PkhKs5VMJ1YAb2ebS5AEGXUgRsxQHt38U8aefK3") 
    });
    console.log(poolPositions);
    console.log(pairInfo);
    //8377610
}
monitor();
// temp();
bot.launch();
console.log("Bot is running...");