import { Telegraf,Markup } from "telegraf";
import dotenv from "dotenv"
dotenv.config();
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
    const poolPositions = await fetchPoolPositions(wallet.publicKey.toString());
})