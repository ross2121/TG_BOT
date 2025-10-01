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
const auth_1 = require("./auth");
const swapHandler_1 = require("./swapHandler");
const bs58_1 = __importDefault(require("bs58"));
const axios_1 = __importDefault(require("axios"));
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
const bot = new telegraf_1.Telegraf(process.env.TELEGRAM_API || "");
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const userStates = new Map();
const DEFAULT_KEYBOARD = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("📊 Track Wallet Positions", "track_positions")],
    [telegraf_1.Markup.button.callback("🔐 Create New Wallet", "create_wallet")],
    [telegraf_1.Markup.button.callback("🔄 Swap Tokens", "swap_tokens")]
]);
bot.start((ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("Welcome to the Saros DLMM Bot! 🚀\n\nChoose an option to begin:", Object.assign({}, DEFAULT_KEYBOARD));
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
        // Check if user already has a wallet
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
bot.on("text", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
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
            const positionData = positions.map(position => ({
                mint: position.positionMint.toString(),
                lowerId: position.lowerBinId.toString(),
                upperId: position.upperBinId.toString(),
                Previous: 0.0,
                Market: poolAddress,
                Status: client_1.Status.Active
            }));
            positions.forEach((position, index) => {
                response += `*Position ${index + 1}*\n`;
                response += ` •  *Mint:* \`${position.positionMint}\`\n`;
                response += ` •  *Lower Bin ID:* ${position.lowerBinId}\n`;
                response += ` •  *Upper Bin ID:* ${position.upperBinId}\n\n`;
            });
            yield prisma.user.create({
                data: {
                    telegram_id: userId.toString(),
                    public_key: walletAddress,
                    positions: {
                        create: positionData
                    }
                }
            });
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
        const publickey = new web3_js_1.PublicKey("HvFfbbDXggmz7UfE21rdL8x6RBX5RpEPvw7kUJVkCk9A");
        // const data= await liquidityBookService.getPositionAccount(publickey);
        // console.log(data);
        const pairInfo = yield liquidityBookService.getPairAccount(new web3_js_1.PublicKey("9P3N4QxjMumpTNNdvaNNskXu2t7VHMMXtePQB72kkSAk"));
        const activeBin = pairInfo.activeId;
        const pool = yield liquidityBookService.fetchPoolAddresses();
        // console.log(pool);    
        //         const pul= await   liquidityBookService.
        //    console.log(pul);
        //  const poolPositions = await liquidityBookService.getUserPositions({
        //     payer:publickey,
        //     pair: new PublicKey("Cpjn7PkhKs5VMJ1YAb2ebS5AEGXUgRsxQHt38U8aefK3") 
        // });
        // console.log(poolPositions[0].position)
        const result = yield liquidityBookService.getPositionAccount(new web3_js_1.PublicKey("GhYac22LPuLizrHkWJcyZ7ZAQKNEXjpH2Jw5dD98BvAY"));
        const poolinfor = yield liquidityBookService.fetchPoolMetadata(pool[1]);
        const poolionf = yield liquidityBookService.getPairAccount(new web3_js_1.PublicKey(poolinfor.poolAddress));
        console.log(liquidityBookService.getDexName());
        console.log(poolionf.tokenMintX);
        console.log(poolionf.tokenMintX);
        const response = yield axios_1.default.get(`https://lite-api.jup.ag/price/v3?ids=${poolinfor.poolAddress}`);
        console.log(response.data);
        // const tokenData = response.data.data[poolionf.tokenMintX];
        // console.log(tokenData.symbol); // Token symbol
        // console.log(tokenData.name);
        console.log(result);
        // console.log(poolPositions);
        // console.log(pairInfo);
        //8377610
    });
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
