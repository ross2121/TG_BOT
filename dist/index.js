"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const dotenv_1 = __importDefault(require("dotenv"));
const web3_js_1 = require("@solana/web3.js");
const dlmm_sdk_1 = require("@saros-finance/dlmm-sdk");
const client_1 = require("@prisma/client");
const monitor_1 = require("./services/monitor");
const auth_1 = require("./services/auth");
const swapHandler_1 = require("./services/swapHandler");
const cleopatra_1 = require("./strategies/cleopatra");
const bs58_1 = __importDefault(require("bs58"));
const axios_1 = __importDefault(require("axios"));
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
const bot = new telegraf_1.Telegraf(process.env.TELEGRAM_API || "");
const userStates = new Map();
const mainKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("📊 Track Wallet Positions", "track_positions")],
    [telegraf_1.Markup.button.callback("🔐 Create New Wallet", "create_wallet")],
    [telegraf_1.Markup.button.callback("🔄 Swap Tokens", "swap_tokens")],
    [telegraf_1.Markup.button.callback("💼 Manage Wallet", "manage_wallet")],
    [telegraf_1.Markup.button.callback("🚀 Start Strategy", "start_strategy")],
    [telegraf_1.Markup.button.callback("⏹️ Stop Strategy", "stop_strategy")],
    [telegraf_1.Markup.button.callback("📈 Exit Position", "exit_position")]
]);
bot.start((ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("Welcome to the Saros DLMM Bot! 🚀\n\nChoose an option to begin:", Object.assign({}, mainKeyboard));
}));
bot.command("menu", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("Main Menu:", Object.assign({}, mainKeyboard));
}));
bot.action("track_positions", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    userStates.set(ctx.from.id, { step: 'awaiting_pool' });
    yield ctx.reply("🏊 Please enter the pool address you want to analyze:");
}));
bot.action("swap_tokens", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, swapHandler_1.handleSwapCommand)(ctx, userStates);
}));
bot.action("create_wallet", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = ctx.from.id;
        const existingUser = yield prisma.user.findUnique({
            where: { telegram_id: userId.toString() }
        });
        if (existingUser && existingUser.encrypted_private_key) {
            yield ctx.reply(`⚠️ You already have a wallet!\n\n🔑 **Your Public Key:**\n\`${existingUser.public_key}\`\n\n⚠️ For security reasons, we cannot show your private key again. Make sure you saved it previously!`, { parse_mode: 'Markdown' });
            return;
        }
        const wallet = (0, auth_1.generateWallet)();
        const { encrypted, iv } = (0, auth_1.encryptPrivateKey)(wallet.secretKey);
        if (existingUser) {
            yield prisma.user.update({
                where: { telegram_id: userId.toString() },
                data: {
                    public_key: wallet.publicKey,
                    encrypted_private_key: encrypted,
                    encryption_iv: iv
                }
            });
        }
        else {
            yield prisma.user.create({
                data: {
                    telegram_id: userId.toString(),
                    public_key: wallet.publicKey,
                    encrypted_private_key: encrypted,
                    encryption_iv: iv
                }
            });
        }
        const privateKeyBase58 = bs58_1.default.encode(wallet.secretKey);
        yield ctx.reply(`✅ **Wallet Created Successfully!**\n\n` +
            `🔑 **Public Key (Share this):**\n\`${wallet.publicKey}\`\n\n` +
            `🔐 **Private Key (NEVER share this!):**\n\`${privateKeyBase58}\`\n\n` +
            `⚠️ **IMPORTANT:**\n` +
            `• Save your private key in a secure location\n` +
            `• Never share it with anyone\n` +
            `• This is the ONLY time we'll show your private key\n` +
            `• You can import this wallet into Phantom, Solflare, etc.`, { parse_mode: 'Markdown' });
    }
    catch (error) {
        console.error("Error creating wallet:", error);
        yield ctx.reply("❌ An error occurred while creating your wallet. Please try again.");
    }
}));
bot.action("manage_wallet", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = ctx.from.id;
        const existingUser = yield prisma.user.findUnique({
            where: { telegram_id: userId.toString() }
        });
        if (!existingUser || !existingUser.encrypted_private_key) {
            yield ctx.reply("❌ You don't have a wallet yet!\n\n" +
                "Click 'Create New Wallet' to get started.", Object.assign({}, mainKeyboard));
            return;
        }
        const managementKeyboard = telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("🔴 Disconnect Wallet", "disconnect_wallet")],
            [telegraf_1.Markup.button.callback("◀️ Back to Menu", "back_to_menu")]
        ]);
        yield ctx.reply(`💼 **Wallet Management**\n\n` +
            `🔑 **Your Public Key:**\n\`${existingUser.public_key}\`\n\n` +
            `⚠️ **Warning:** Disconnecting your wallet will remove it from this bot. ` +
            `Make sure you have saved your private key!`, Object.assign({ parse_mode: 'Markdown' }, managementKeyboard));
    }
    catch (error) {
        console.error("Error managing wallet:", error);
        yield ctx.reply("❌ An error occurred. Please try again.");
    }
}));
bot.action("disconnect_wallet", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const confirmKeyboard = telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("✅ Yes, Disconnect", "confirm_disconnect")],
        [telegraf_1.Markup.button.callback("❌ Cancel", "cancel_disconnect")]
    ]);
    yield ctx.reply(`⚠️ **Confirm Wallet Disconnection**\n\n` +
        `Are you sure you want to disconnect your wallet?\n\n` +
        `⚠️ This will:\n` +
        `• Remove your wallet from this bot\n` +
        `• Delete all your tracked positions\n` +
        `• Stop monitoring alerts\n\n` +
        `❗ Make sure you have backed up your private key!\n` +
        `We cannot recover it for you.`, Object.assign({ parse_mode: 'Markdown' }, confirmKeyboard));
}));
bot.action("confirm_disconnect", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = ctx.from.id;
        yield prisma.position.deleteMany({
            where: { user: { telegram_id: userId.toString() } }
        });
        yield prisma.user.delete({
            where: { telegram_id: userId.toString() }
        });
        yield ctx.reply(`✅ **Wallet Disconnected Successfully**\n\n` +
            `Your wallet and all positions have been removed from the bot.\n\n` +
            `You can create a new wallet or reconnect anytime!`, Object.assign({}, mainKeyboard));
    }
    catch (error) {
        console.error("Error disconnecting wallet:", error);
        yield ctx.reply("❌ An error occurred while disconnecting. Please try again.");
    }
}));
bot.action("cancel_disconnect", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("✅ Cancelled. Your wallet is still connected.", Object.assign({}, mainKeyboard));
}));
bot.action("back_to_menu", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("Welcome back! Choose an option:", Object.assign({}, mainKeyboard));
}));
bot.action("start_strategy", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = ctx.from.id.toString();
        yield cleopatra_1.cleopatraStrategy.startStrategy(userId);
        yield ctx.reply("🚀 **Cleopatra Strategy Started!**\n\n" +
            "Your bot will now:\n" +
            "• Find the best pools automatically\n" +
            "• Execute 50/50 swaps\n" +
            "• Create ±20 bin liquidity positions\n" +
            "• Monitor and rebalance every hour\n" +
            "• Compound earnings", { parse_mode: 'Markdown' });
    }
    catch (error) {
        console.error("Error starting strategy:", error);
        yield ctx.reply("❌ Failed to start strategy. Make sure you have a wallet and sufficient balance.");
    }
}));
bot.action("stop_strategy", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = ctx.from.id.toString();
        yield cleopatra_1.cleopatraStrategy.stopStrategy(userId);
        yield ctx.reply("⏹️ **Strategy Stopped**\n\nYour Cleopatra strategy has been stopped.", { parse_mode: 'Markdown' });
    }
    catch (error) {
        console.error("Error stopping strategy:", error);
        yield ctx.reply("❌ Failed to stop strategy.");
    }
}));
bot.action("exit_position", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    userStates.set(ctx.from.id, { step: 'awaiting_position_mint' });
    yield ctx.reply("📈 **Exit Position**\n\nPlease enter the position mint address you want to exit:");
}));
bot.on("text", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const userId = ctx.from.id;
    const message = ctx.message.text;
    const userState = userStates.get(userId);
    if (!userState) {
        yield ctx.reply("Please use the menu buttons to start! 👆", Object.assign({}, mainKeyboard));
        return;
    }
    if (userState.swapState) {
        yield (0, swapHandler_1.handleSwapFlow)(ctx, message, userId, userStates);
        return;
    }
    try {
        const liquidityBookService = new dlmm_sdk_1.LiquidityBookServices({
            mode: dlmm_sdk_1.MODE.MAINNET,
            options: {
                rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
            },
        });
        if (userState.step === 'awaiting_pool') {
            try {
                new web3_js_1.PublicKey(message);
            }
            catch (error) {
                yield ctx.reply("❌ Invalid pool address. Please enter a valid Solana public key:");
                return;
            }
            userState.pool = message;
            userState.step = 'awaiting_wallet';
            yield ctx.reply(`✅ Pool address saved: ${message}\n\n📝 Now, please enter the wallet public key to check for positions:`);
        }
        else if (userState.step === 'awaiting_wallet') {
            const poolAddress = userState.pool;
            const walletAddress = message;
            try {
                new web3_js_1.PublicKey(walletAddress);
            }
            catch (error) {
                yield ctx.reply("❌ Invalid wallet address. Please enter a valid Solana public key:");
                return;
            }
            yield ctx.reply(`⏳ Searching for positions for wallet ${walletAddress} in pool ${poolAddress}...`);
            const positions = yield liquidityBookService.getUserPositions({
                payer: new web3_js_1.PublicKey(walletAddress),
                pair: new web3_js_1.PublicKey(poolAddress)
            });
            if (positions.length === 0) {
                yield ctx.reply(`🤷 No positions found for wallet \`${walletAddress}\` in pool \`${poolAddress}\`.`, { parse_mode: 'Markdown' });
                userStates.delete(userId);
                return;
            }
            let response = `🎯 **Analysis Complete**\n\n`;
            response += `📍 **Pool Address:** \`${poolAddress}\`\n`;
            response += `👤 **Wallet:** \`${walletAddress}\`\n`;
            response += `📊 **Total Positions Found:** ${positions.length}\n\n`;
            const pairInfo = yield liquidityBookService.getPairAccount(new web3_js_1.PublicKey(poolAddress));
            const poolMetadata = yield liquidityBookService.fetchPoolMetadata(poolAddress);
            const tokenXMint = pairInfo.tokenMintX.toString();
            const tokenYMint = pairInfo.tokenMintY.toString();
            const tokenXDecimals = poolMetadata.extra.tokenBaseDecimal;
            const tokenYDecimals = poolMetadata.extra.tokenQuoteDecimal;
            const priceResponse = yield axios_1.default.get(`https://lite-api.jup.ag/price/v3?ids=${tokenXMint},${tokenYMint}`);
            const tokenXPrice = ((_b = (_a = priceResponse.data.data) === null || _a === void 0 ? void 0 : _a[tokenXMint]) === null || _b === void 0 ? void 0 : _b.price) || 0;
            const tokenYPrice = ((_d = (_c = priceResponse.data.data) === null || _c === void 0 ? void 0 : _c[tokenYMint]) === null || _d === void 0 ? void 0 : _d.price) || 0;
            const positionData = yield Promise.all(positions.map((position) => __awaiter(void 0, void 0, void 0, function* () {
                const positionAddress = new web3_js_1.PublicKey(position.position);
                const reserveInfo = yield liquidityBookService.getBinsReserveInformation({
                    position: positionAddress,
                    pair: new web3_js_1.PublicKey(poolAddress),
                    payer: new web3_js_1.PublicKey(walletAddress)
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
                    Status: client_1.Status.Active,
                    initialTokenAAmount: adjustedTokenX,
                    initialTokenBAmount: adjustedTokenY,
                    initialTokenAPriceUSD: tokenXPrice,
                    initialTokenBPriceUSD: tokenYPrice,
                    lastILWarningPercent: 0.0
                };
            })));
            positions.forEach((position, index) => {
                response += `*Position ${index + 1}*\n`;
                response += ` •  *Mint:* \`${position.positionMint}\`\n`;
                response += ` •  *Lower Bin ID:* ${position.lowerBinId}\n`;
                response += ` •  *Upper Bin ID:* ${position.upperBinId}\n\n`;
            });
            const existingUser = yield prisma.user.findUnique({
                where: { telegram_id: userId.toString() }
            });
            if (existingUser) {
                yield prisma.position.deleteMany({
                    where: {
                        userId: existingUser.id,
                        Market: poolAddress
                    }
                });
                yield prisma.position.createMany({
                    data: positionData.map(pos => (Object.assign(Object.assign({}, pos), { userId: existingUser.id })))
                });
            }
            else {
                yield prisma.user.create({
                    data: {
                        telegram_id: userId.toString(),
                        public_key: walletAddress,
                        positions: {
                            create: positionData
                        }
                    }
                });
            }
            yield ctx.reply(response, { parse_mode: 'Markdown' });
            userStates.delete(userId);
        }
        else if (userState.step === 'awaiting_position_mint') {
            try {
                new web3_js_1.PublicKey(message);
                const userId = ctx.from.id.toString();
                yield cleopatra_1.cleopatraStrategy.exitPosition(userId, message);
                yield ctx.reply(`✅ **Position Exited**\n\nPosition \`${message}\` has been successfully exited.`, { parse_mode: 'Markdown' });
            }
            catch (error) {
                console.error("Error exiting position:", error);
                yield ctx.reply("❌ Failed to exit position. Please check the position mint address.");
            }
            userStates.delete(userId);
        }
    }
    catch (error) {
        console.error("Error:", error);
        yield ctx.reply("❌ An unexpected error occurred. Please try again.");
        userStates.delete(userId);
    }
}));
(0, monitor_1.monitor)();
bot.launch();
console.log("Bot is running...");
