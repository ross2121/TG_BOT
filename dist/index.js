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
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
const bot = new telegraf_1.Telegraf(process.env.TELEGRAM_API || "");
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const userStates = new Map();
const DEFAULT_KEYBOARD = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("📊 Track Wallet Positions", "track_positions")]
]);
bot.start((ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("Welcome to the Saros DLMM Bot! 🚀\n\nChoose an option to begin:", Object.assign({}, DEFAULT_KEYBOARD));
}));
bot.action("track_positions", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    userStates.set(ctx.from.id, { step: 'awaiting_pool' });
    yield ctx.reply("🏊 Please enter the pool address you want to analyze:");
}));
bot.on("text", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = ctx.from.id;
    const message = ctx.message.text;
    const userState = userStates.get(userId);
    if (!userState) {
        yield ctx.reply("Please use the menu buttons to start! 👆", Object.assign({}, DEFAULT_KEYBOARD));
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
        //         const pul= await   liquidityBookService.
        //    console.log(pul);
        const poolPositions = yield liquidityBookService.getUserPositions({
            payer: publickey,
            pair: new web3_js_1.PublicKey("Cpjn7PkhKs5VMJ1YAb2ebS5AEGXUgRsxQHt38U8aefK3")
        });
        console.log(poolPositions);
        console.log(pairInfo);
        //8377610
    });
}
(0, monitor_1.monitor)();
// temp();
bot.launch();
console.log("Bot is running...");
