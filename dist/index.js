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
const monitor_1 = require("./monitor");
const auth_1 = require("./auth");
const swapHandler_1 = require("./swapHandler");
const express_1 = __importDefault(require("express"));
const bs58_1 = __importDefault(require("bs58"));
const axios_1 = __importDefault(require("axios"));
dotenv_1.default.config();
const port = process.env.PORT || 4000;
const app = (0, express_1.default)();
app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
const prisma = new client_1.PrismaClient();
const bot = new telegraf_1.Telegraf(process.env.TELEGRAM_API || "");
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const userStates = new Map();
const DEFAULT_KEYBOARD = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("📊 Track Wallet Positions", "track_positions")],
    [telegraf_1.Markup.button.callback("🔐 Create New Wallet", "create_wallet")],
    [telegraf_1.Markup.button.callback("🔄 Swap Tokens", "swap_tokens")],
    [telegraf_1.Markup.button.callback("💼 Manage Wallet", "manage_wallet")]
]);
bot.start((ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("Welcome to the Saros DLMM Bot! 🚀\n\nChoose an option to begin:", Object.assign({}, DEFAULT_KEYBOARD));
}));
bot.command("menu", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("Main Menu:", Object.assign({}, DEFAULT_KEYBOARD));
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
        // Generate new wallet
        const wallet = (0, auth_1.generateWallet)();
        const { encrypted, iv } = (0, auth_1.encryptPrivateKey)(wallet.secretKey);
        // Save to database
        if (existingUser) {
            // Update existing user with wallet
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
            // Create new user with wallet
            yield prisma.user.create({
                data: {
                    telegram_id: userId.toString(),
                    public_key: wallet.publicKey,
                    encrypted_private_key: encrypted,
                    encryption_iv: iv
                }
            });
        }
        // Convert secret key to base58 for display
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
                "Click 'Create New Wallet' to get started.", Object.assign({}, DEFAULT_KEYBOARD));
            return;
        }
        // Show wallet info with management options
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
        // Delete all positions first
        yield prisma.position.deleteMany({
            where: { user: { telegram_id: userId.toString() } }
        });
        // Delete the user and wallet
        yield prisma.user.delete({
            where: { telegram_id: userId.toString() }
        });
        yield ctx.reply(`✅ **Wallet Disconnected Successfully**\n\n` +
            `Your wallet and all positions have been removed from the bot.\n\n` +
            `You can create a new wallet or reconnect anytime!`, Object.assign({}, DEFAULT_KEYBOARD));
    }
    catch (error) {
        console.error("Error disconnecting wallet:", error);
        yield ctx.reply("❌ An error occurred while disconnecting. Please try again.");
    }
}));
bot.action("cancel_disconnect", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("✅ Cancelled. Your wallet is still connected.", Object.assign({}, DEFAULT_KEYBOARD));
}));
bot.action("back_to_menu", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("Welcome back! Choose an option:", Object.assign({}, DEFAULT_KEYBOARD));
}));
bot.on("text", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const userId = ctx.from.id;
    const message = ctx.message.text;
    const userState = userStates.get(userId);
    if (!userState) {
        yield ctx.reply("Please use the menu buttons to start! 👆", Object.assign({}, DEFAULT_KEYBOARD));
        return;
    }
    // Handle swap flow
    if (userState.swapState) {
        yield (0, swapHandler_1.handleSwapFlow)(ctx, message, userId, userStates);
        return;
    }
    try {
        const liquidityBookService = new dlmm_sdk_1.LiquidityBookServices({
            mode: dlmm_sdk_1.MODE.MAINNET,
            options: {
                rpcUrl: RPC_URL,
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
            // Get pair info for token prices and decimals
            const pairInfo = yield liquidityBookService.getPairAccount(new web3_js_1.PublicKey(poolAddress));
            const poolMetadata = yield liquidityBookService.fetchPoolMetadata(poolAddress);
            const tokenXMint = pairInfo.tokenMintX.toString();
            const tokenYMint = pairInfo.tokenMintY.toString();
            const tokenXDecimals = poolMetadata.extra.tokenBaseDecimal;
            const tokenYDecimals = poolMetadata.extra.tokenQuoteDecimal;
            // Fetch current token prices
            const priceResponse = yield axios_1.default.get(`https://lite-api.jup.ag/price/v3?ids=${tokenXMint},${tokenYMint}`);
            const tokenXPrice = ((_b = (_a = priceResponse.data.data) === null || _a === void 0 ? void 0 : _a[tokenXMint]) === null || _b === void 0 ? void 0 : _b.price) || 0;
            const tokenYPrice = ((_d = (_c = priceResponse.data.data) === null || _c === void 0 ? void 0 : _c[tokenYMint]) === null || _d === void 0 ? void 0 : _d.price) || 0;
            // Calculate initial values for each position
            const positionData = yield Promise.all(positions.map((position) => __awaiter(void 0, void 0, void 0, function* () {
                // Get reserve information for this position
                const positionAddress = new web3_js_1.PublicKey(position.position);
                const reserveInfo = yield liquidityBookService.getBinsReserveInformation({
                    position: positionAddress,
                    pair: new web3_js_1.PublicKey(poolAddress),
                    payer: new web3_js_1.PublicKey(walletAddress)
                });
                // Calculate total token amounts
                let totalTokenX = 0;
                let totalTokenY = 0;
                reserveInfo.forEach(bin => {
                    totalTokenX += Number(bin.reserveX);
                    totalTokenY += Number(bin.reserveY);
                });
                // Adjust for decimals
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
            // Check if user exists
            const existingUser = yield prisma.user.findUnique({
                where: { telegram_id: userId.toString() }
            });
            if (existingUser) {
                // User exists - delete old positions and add new ones
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
                // Create new user with positions
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
            userStates.delete(userId); // Clean up state after completion
        }
    }
    catch (error) {
        console.error("Error:", error);
        yield ctx.reply("❌ An unexpected error occurred. Please try again.");
        userStates.delete(userId); // Clean up state on error
    }
}));
function temp() {
    return __awaiter(this, void 0, void 0, function* () {
        const liquidityBookService = new dlmm_sdk_1.LiquidityBookServices({
            mode: dlmm_sdk_1.MODE.MAINNET,
        });
        const publickey = new web3_js_1.PublicKey("2sZfUCe5q55K1MjYP7HYRmU2Br6MS7DATtzSqgbZGtaN");
        // const data= await liquidityBookService.getPositionAccount(publickey);
        // console.log(data);
        const pairInfo = yield liquidityBookService.getPairAccount(new web3_js_1.PublicKey("9P3N4QxjMumpTNNdvaNNskXu2t7VHMMXtePQB72kkSAk"));
        const activeBin = pairInfo.activeId;
        const pool = yield liquidityBookService.fetchPoolAddresses();
        // console.log(pool);    
        //         const pul= await   liquidityBookService.
        //    console.log(pul);                                                                                                                                                                                                                                                                         
        const pairAddress = new web3_js_1.PublicKey("8vZHTVMdYvcPFUoHBEbcFyfSKnjWtvbNgYpXg1aiC2uS");
        const poolPositions = yield liquidityBookService.getUserPositions({
            payer: publickey,
            pair: pairAddress
        });
        console.log(poolPositions[0]);
        // Get actual token amounts from the position
        if (poolPositions.length > 0) {
            // Get the current active bin of the pool
            const currentPairInfo = yield liquidityBookService.getPairAccount(pairAddress);
            const currentActiveBin = currentPairInfo.activeId;
            const positionAddress = new web3_js_1.PublicKey(poolPositions[0].position);
            const reserveInfo = yield liquidityBookService.getBinsReserveInformation({
                position: positionAddress,
                pair: pairAddress,
                payer: publickey
            });
            console.log(reserveInfo);
            // Calculate total token amounts across all bins
            // let totalTokenX = 0;
            // let totalTokenY = 0;
            // reserveInfo.forEach(bin => {
            //     totalTokenX += Number(bin.reserveX);
            //     totalTokenY += Number(bin.reserveY);
            // });
            // console.log("\n=== Pool & Position Info ===");
            // console.log("Current Active Bin ID:", currentActiveBin);
            // console.log("Your Position Range: Bins", poolPositions[0].lowerBinId, "to", poolPositions[0].upperBinId);
            // console.log("\nExplanation:");
            // if (currentActiveBin < poolPositions[0].lowerBinId) {
            //     console.log("✓ Current price is BELOW your position range");
            //     console.log("✓ That's why you only have Token Y (quote token)");
            //     console.log("✓ As price rises into your range, Token Y will convert to Token X");
            // } else if (currentActiveBin > poolPositions[0].upperBinId) {
            //     console.log("✓ Current price is ABOVE your position range");
            //     console.log("✓ That's why you only have Token X (base token)");
            //     console.log("✓ As price falls into your range, Token X will convert to Token Y");
            // } else {
            //     console.log("✓ Current price is WITHIN your position range");
            //     console.log("✓ You should have both tokens in the active bin");
            // }
            // console.log("\n=== Position Token Amounts ===");
            // console.log("Total Token X (Base):", totalTokenX);
            // console.log("Total Token Y (Quote):", totalTokenY);
            // console.log("\nDetailed bin reserves:", reserveInfo);
        }
        // const result = await liquidityBookService.getPositionAccount(new PublicKey("GhYac22LPuLizrHkWJcyZ7ZAQKNEXjpH2Jw5dD98BvAY"));
        // const poolinfor:PoolMetadata=await liquidityBookService.fetchPoolMetadata(pool[1]);  
        //    const poolionf=await liquidityBookService.getPairAccount(new PublicKey(poolinfor.poolAddress));
        //    console.log(liquidityBookService.getDexName());
        //    console.log(poolionf.tokenMintX);
        //    console.log(poolionf.tokenMintX);
        // const response = await axios.get(`https://lite-api.jup.ag/price/v3?ids=${poolinfor.poolAddress}`);
        // console.log(response.data);
        // const tokenData = response.data.data[poolionf.tokenMintX];
        // console.log(tokenData.symbol); // Token symbol
        // console.log(tokenData.name);
        // console.log(result);
        // console.log(poolPositions);
        // console.log(pairInfo);
        //8377610
    });
}
(0, monitor_1.monitor)();
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
