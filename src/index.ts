import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
import { PublicKey } from "@solana/web3.js";
import { LiquidityBookServices, MODE, PoolMetadata } from "@saros-finance/dlmm-sdk";
import { PrismaClient, Status } from "@prisma/client";
import { monitor } from "./services/monitor";
import { generateWallet, encryptPrivateKey } from "./services/auth";
import { handleSwapCommand, handleSwapFlow } from "./services/swapHandler";
import { cleopatraStrategy } from "./strategies/strategy";
import { UserState } from "./types";
import { DEFAULT_KEYBOARD } from "./utils/constants";
import bs58 from "bs58";
import axios from "axios";

dotenv.config();

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.TELEGRAM_API || "");
const userStates = new Map<number, UserState>();

const mainKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("📊 Track Wallet Positions", "track_positions")],
    [Markup.button.callback("🔐 Create New Wallet", "create_wallet")],
    [Markup.button.callback("🔄 Swap Tokens", "swap_tokens")],
    [Markup.button.callback("💼 Manage Wallet", "manage_wallet")],
    [Markup.button.callback("🚀 Start Strategy", "start_strategy")],
    [Markup.button.callback("⏹️ Stop Strategy", "stop_strategy")],
    [Markup.button.callback("📈 Exit Position", "exit_position")]
]);

bot.start(async (ctx) => {
    await ctx.reply("Welcome to the Saros DLMM Bot! 🚀\n\nChoose an option to begin:", {
        ...mainKeyboard
    });
});

bot.command("menu", async (ctx) => {
    await ctx.reply("Main Menu:", {
        ...mainKeyboard
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
        
        const existingUser = await prisma.user.findUnique({
            where: { telegram_id: userId.toString() }
        });
        
        if (existingUser && existingUser.encrypted_private_key) {
            await ctx.reply(`⚠️ You already have a wallet!\n\n🔑 **Your Public Key:**\n\`${existingUser.public_key}\`\n\n⚠️ For security reasons, we cannot show your private key again. Make sure you saved it previously!`, 
                { parse_mode: 'Markdown' });
            return;
        }
        
        const wallet = generateWallet();
        const { encrypted, iv } = encryptPrivateKey(wallet.secretKey);
        
        if (existingUser) {
            await prisma.user.update({
                where: { telegram_id: userId.toString() },
                data: {
                    public_key: wallet.publicKey,
                    encrypted_private_key: encrypted,
                    encryption_iv: iv
                }
            });
        } else {
            await prisma.user.create({
                data: {
                    telegram_id: userId.toString(),
                    public_key: wallet.publicKey,
                    encrypted_private_key: encrypted,
                    encryption_iv: iv
                }
            });
        }
        
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

bot.action("manage_wallet", async (ctx) => {
    try {
        const userId = ctx.from.id;
        
        const existingUser = await prisma.user.findUnique({
            where: { telegram_id: userId.toString() }
        });
        
        if (!existingUser || !existingUser.encrypted_private_key) {
            await ctx.reply(
                "❌ You don't have a wallet yet!\n\n" +
                "Click 'Create New Wallet' to get started.",
                { ...mainKeyboard }
            );
            return;
        }
        
        const managementKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔴 Disconnect Wallet", "disconnect_wallet")],
            [Markup.button.callback("◀️ Back to Menu", "back_to_menu")]
        ]);
        
        await ctx.reply(
            `💼 **Wallet Management**\n\n` +
            `🔑 **Your Public Key:**\n\`${existingUser.public_key}\`\n\n` +
            `⚠️ **Warning:** Disconnecting your wallet will remove it from this bot. ` +
            `Make sure you have saved your private key!`,
            { parse_mode: 'Markdown', ...managementKeyboard }
        );
        
    } catch (error) {
        console.error("Error managing wallet:", error);
        await ctx.reply("❌ An error occurred. Please try again.");
    }
});

bot.action("disconnect_wallet", async (ctx) => {
    const confirmKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("✅ Yes, Disconnect", "confirm_disconnect")],
        [Markup.button.callback("❌ Cancel", "cancel_disconnect")]
    ]);
    
    await ctx.reply(
        `⚠️ **Confirm Wallet Disconnection**\n\n` +
        `Are you sure you want to disconnect your wallet?\n\n` +
        `⚠️ This will:\n` +
        `• Remove your wallet from this bot\n` +
        `• Delete all your tracked positions\n` +
        `• Stop monitoring alerts\n\n` +
        `❗ Make sure you have backed up your private key!\n` +
        `We cannot recover it for you.`,
        { parse_mode: 'Markdown', ...confirmKeyboard }
    );
});

bot.action("confirm_disconnect", async (ctx) => {
    try {
        const userId = ctx.from.id;
        
        await prisma.position.deleteMany({
            where: { user: { telegram_id: userId.toString() } }
        });
        
        await prisma.user.delete({
            where: { telegram_id: userId.toString() }
        });
        
        await ctx.reply(
            `✅ **Wallet Disconnected Successfully**\n\n` +
            `Your wallet and all positions have been removed from the bot.\n\n` +
            `You can create a new wallet or reconnect anytime!`,
            { ...mainKeyboard }
        );
        
    } catch (error) {
        console.error("Error disconnecting wallet:", error);
        await ctx.reply("❌ An error occurred while disconnecting. Please try again.");
    }
});

bot.action("cancel_disconnect", async (ctx) => {
    await ctx.reply(
        "✅ Cancelled. Your wallet is still connected.",
        { ...mainKeyboard }
    );
});

bot.action("back_to_menu", async (ctx) => {
    await ctx.reply(
        "Welcome back! Choose an option:",
        { ...mainKeyboard }
    );
});

bot.action("start_strategy", async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        await cleopatraStrategy.startStrategy(userId);
        await ctx.reply(
            "🚀 **Cleopatra Strategy Started!**\n\n" +
            "Your bot will now:\n" +
            "• Find the best pools automatically\n" +
            "• Execute 50/50 swaps\n" +
            "• Create ±20 bin liquidity positions\n" +
            "• Monitor and rebalance every hour\n" +
            "• Compound earnings",
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        console.error("Error starting strategy:", error);
        await ctx.reply("❌ Failed to start strategy. Make sure you have a wallet and sufficient balance.");
    }
});

bot.action("stop_strategy", async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        await cleopatraStrategy.stopStrategy(userId);
        await ctx.reply("⏹️ **Strategy Stopped**\n\nYour Cleopatra strategy has been stopped.", { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Error stopping strategy:", error);
        await ctx.reply("❌ Failed to stop strategy.");
    }
});

bot.action("exit_position", async (ctx) => {
    userStates.set(ctx.from.id, { step: 'awaiting_position_mint' });
    await ctx.reply("📈 **Exit Position**\n\nPlease enter the position mint address you want to exit:");
});

bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    const message = ctx.message.text;
    const userState = userStates.get(userId);
    
    if (!userState) {
        await ctx.reply("Please use the menu buttons to start! 👆", {
            ...mainKeyboard
        });
        return;
    }
    
    if (userState.swapState) {
        await handleSwapFlow(ctx, message, userId, userStates);
        return;
    }
    
    try {
        const liquidityBookService = new LiquidityBookServices({
            mode: MODE.MAINNET,
            options: {
                rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
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
            const poolAddress = userState.pool!;
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
            
            const pairInfo = await liquidityBookService.getPairAccount(new PublicKey(poolAddress));
            const poolMetadata = await liquidityBookService.fetchPoolMetadata(poolAddress);
            const tokenXMint = pairInfo.tokenMintX.toString();
            const tokenYMint = pairInfo.tokenMintY.toString();
            const tokenXDecimals = poolMetadata.extra.tokenBaseDecimal;
            const tokenYDecimals = poolMetadata.extra.tokenQuoteDecimal;
            
            const priceResponse = await axios.get(
                `https://lite-api.jup.ag/price/v3?ids=${tokenXMint},${tokenYMint}`
            );
            const tokenXPrice = priceResponse.data.data?.[tokenXMint]?.price || 0;
            const tokenYPrice = priceResponse.data.data?.[tokenYMint]?.price || 0;
            
            const positionData = await Promise.all(positions.map(async (position) => {
                const positionAddress = new PublicKey(position.position);
                const reserveInfo = await liquidityBookService.getBinsReserveInformation({
                    position: positionAddress,
                    pair: new PublicKey(poolAddress),
                    payer: new PublicKey(walletAddress)
                });
                
                let totalTokenX = 0;
                let totalTokenY = 0;
                reserveInfo.forEach(bin => {
                    totalTokenX += Number(bin.reserveX);
                    totalTokenY += Number(bin.reserveY);
                });
                
                const adjustedTokenX = totalTokenX / Math.pow(10, tokenXDecimals);
                const adjustedTokenY = totalTokenY / Math.pow(10, tokenYDecimals);
                
                return {
                    mint: position.positionMint.toString(),
                    lowerId: position.lowerBinId.toString(),
                    upperId: position.upperBinId.toString(),
                    Previous: 0.0,
                    Market: poolAddress,
                    Status: Status.Active,
                    initialTokenAAmount: adjustedTokenX,
                    initialTokenBAmount: adjustedTokenY,
                    initialTokenAPriceUSD: tokenXPrice,
                    initialTokenBPriceUSD: tokenYPrice,
                    lastILWarningPercent: 0.0
                };
            }));
            
            positions.forEach((position, index) => {
                response += `*Position ${index + 1}*\n`;
                response += ` •  *Mint:* \`${position.positionMint}\`\n`;
                response += ` •  *Lower Bin ID:* ${position.lowerBinId}\n`;
                response += ` •  *Upper Bin ID:* ${position.upperBinId}\n\n`;
            });
            
            const existingUser = await prisma.user.findUnique({
                where: { telegram_id: userId.toString() }
            });
            
            if (existingUser) {
                await prisma.position.deleteMany({
                    where: { 
                        userId: existingUser.id,
                        Market: poolAddress 
                    }
                });
                
                await prisma.position.createMany({
                    data: positionData.map(pos => ({
                        ...pos,
                        userId: existingUser.id
                    }))
                });
            } else {
                await prisma.user.create({
                    data: {
                        telegram_id: userId.toString(),
                        public_key: walletAddress,
                        positions: {
                            create: positionData
                        }
                    }
                });
            }
            await ctx.reply(response, { parse_mode: 'Markdown' });
            userStates.delete(userId);
        } else if (userState.step === 'awaiting_position_mint') {
            try {
                new PublicKey(message);
                const userId = ctx.from.id.toString();
                await cleopatraStrategy.exitPosition(userId, message);
                await ctx.reply(`✅ **Position Exited**\n\nPosition \`${message}\` has been successfully exited.`, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error("Error exiting position:", error);
                await ctx.reply("❌ Failed to exit position. Please check the position mint address.");
            }
            userStates.delete(userId);
        }

    } catch (error) {
        console.error("Error:", error);
        await ctx.reply("❌ An unexpected error occurred. Please try again.");
        userStates.delete(userId);
    }
});

monitor();
bot.launch();
console.log("Bot is running...");