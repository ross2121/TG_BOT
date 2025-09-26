import { Telegraf,Markup } from "telegraf";
import dotenv from "dotenv"
import { PublicKey } from "@solana/web3.js";
import {
    LiquidityShape,
    PositionInfo,
    RemoveLiquidityType,
    UserPositionsParams
  } from "@saros-finance/dlmm-sdk/types/services";
  import {
    createUniformDistribution,
    findPosition,
    getBinRange,
    getMaxBinArray,
    getMaxPosition,
  } from "@saros-finance/dlmm-sdk/utils";
  import { LiquidityBookServices, MODE } from "@saros-finance/dlmm-sdk";
  
dotenv.config();
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
const bot=new Telegraf(process.env.TELEGRAM_API||"");
const DEFAULT_KEYBOARD=Markup.inlineKeyboard([[
    Markup.button.callback("Enter  the wallet you want to track","track"),
    Markup.button.callback("Positions","Postion")
]]);
bot.start(async (ctx)=>{
    ctx.reply("Welcome to the bot ",{
        ...DEFAULT_KEYBOARD
    });
})
bot.action("track",async(ctx)=>{
    ctx.reply("Enter the public key")
})
bot.on("text",async(ctx)=>{
    const message=ctx.message.text;
    const liquidityBookService = new LiquidityBookServices({
        mode: MODE.MAINNET,
    });
    const publickey=new PublicKey("2KZwHB3m1NZJiGzr7isRqypGeCJpT5H9NjrRZw2wHuKD");
  const data= await liquidityBookService.getPositionAccount(publickey);
  console.log(data);
    // const poolPositions = await liquidityBookService.getUserPositions({
    //     payer: new PublicKey(message),
    //     pair: new PublicKey("YOUR_PAIR_ADDRESS") 
    // });
})
async function temp(){
    const liquidityBookService = new LiquidityBookServices({
        mode: MODE.MAINNET,
    });
    const publickey=new PublicKey("HvFfbbDXggmz7UfE21rdL8x6RBX5RpEPvw7kUJVkCk9A");
    // const data= await liquidityBookService.getPositionAccount(publickey);
    // console.log(data);
     const poolPositions = await liquidityBookService.getUserPositions({
        payer:publickey,
        pair: new PublicKey("Cpjn7PkhKs5VMJ1YAb2ebS5AEGXUgRsxQHt38U8aefK3") 
    });
    console.log(poolPositions);
}
temp();