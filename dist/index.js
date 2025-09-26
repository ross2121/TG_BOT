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
dotenv_1.default.config();
const USDC_TOKEN = {
    id: "usd-coin",
    mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "usdc",
    name: "USD Coin",
    decimals: 6,
    addressSPL: "FXRiEosEvHnpc3XZY1NS7an2PB1SunnYW1f5zppYhXb3",
};
const C98_TOKEN = {
    id: "coin98",
    mintAddress: "C98A4nkJXhpVZNAZdHUA95RpTF3T4whtQubL3YobiUX9",
    symbol: "C98",
    name: "Coin98",
    decimals: 6,
    addressSPL: "EKCdCBjfQ6t5FBfDC2zvmr27PgfVVZU37C8LUE4UenKb",
};
const POOL_PARAMS = {
    address: "EwsqJeioGAXE5EdZHj1QvcuvqgVhJDp9729H5wjh28DD",
    baseToken: C98_TOKEN,
    quoteToken: USDC_TOKEN,
    slippage: 0.5,
    hook: "", // config for reward, adding later
};
const bot = new telegraf_1.Telegraf(process.env.TELEGRAM_API || "");
const DEFAULT_KEYBOARD = telegraf_1.Markup.inlineKeyboard([[
        telegraf_1.Markup.button.callback("Enter  the wallet you want to track", "track"),
        telegraf_1.Markup.button.callback("Positions", "Postion")
    ]]);
bot.start((ctx) => __awaiter(void 0, void 0, void 0, function* () {
    ctx.reply("Welcome to the bot ", Object.assign({}, DEFAULT_KEYBOARD));
}));
bot.action("track", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    ctx.reply("Enter the public key");
}));
bot.on("text", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const message = ctx.message.text;
    const liquidityBookService = new dlmm_sdk_1.LiquidityBookServices({
        mode: dlmm_sdk_1.MODE.MAINNET,
    });
    const publickey = new web3_js_1.PublicKey("2KZwHB3m1NZJiGzr7isRqypGeCJpT5H9NjrRZw2wHuKD");
    const data = yield liquidityBookService.getPositionAccount(publickey);
    console.log(data);
    // const poolPositions = await liquidityBookService.getUserPositions({
    //     payer: new PublicKey(message),
    //     pair: new PublicKey("YOUR_PAIR_ADDRESS") 
    // });
}));
function temp() {
    return __awaiter(this, void 0, void 0, function* () {
        const liquidityBookService = new dlmm_sdk_1.LiquidityBookServices({
            mode: dlmm_sdk_1.MODE.MAINNET,
        });
        const publickey = new web3_js_1.PublicKey("HvFfbbDXggmz7UfE21rdL8x6RBX5RpEPvw7kUJVkCk9A");
        // const data= await liquidityBookService.getPositionAccount(publickey);
        // console.log(data);
        const poolPositions = yield liquidityBookService.getUserPositions({
            payer: publickey,
            pair: new web3_js_1.PublicKey("Cpjn7PkhKs5VMJ1YAb2ebS5AEGXUgRsxQHt38U8aefK3")
        });
        console.log(poolPositions);
    });
}
temp();
