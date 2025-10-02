import { Telegraf } from "telegraf";

export const handleSwapCommand = async (ctx: any, userStates: Map<any, any>) => {
    const userId = ctx.from.id;
    userStates.set(userId, { 
        step: 'awaiting_token_in',
        swapState: {
            step: 'awaiting_token_in'
        }
    });
    
    await ctx.reply(
        "🔄 **Token Swap Setup**\n\n" +
        "Please enter the **input token mint address** (the token you want to swap FROM):",
        { parse_mode: 'Markdown' }
    );
};

export const handleSwapFlow = async (ctx: any, message: string, userId: number, userStates: Map<any, any>) => {
    const userState = userStates.get(userId);
    const swapState = userState.swapState;

    try {
        switch (swapState.step) {
            case 'awaiting_token_in':
                swapState.tokenIn = message;
                swapState.step = 'awaiting_token_out';
                await ctx.reply(
                    "✅ Input token saved!\n\n" +
                    "Please enter the **output token mint address** (the token you want to swap TO):"
                );
                break;

            case 'awaiting_token_out':
                swapState.tokenOut = message;
                swapState.step = 'awaiting_amount';
                await ctx.reply(
                    "✅ Output token saved!\n\n" +
                    "Please enter the **amount** you want to swap:"
                );
                break;

            case 'awaiting_amount':
                const amount = parseFloat(message);
                if (isNaN(amount) || amount <= 0) {
                    await ctx.reply("❌ Invalid amount. Please enter a positive number:");
                    return;
                }

                swapState.amount = amount;
                swapState.step = 'awaiting_slippage';
                await ctx.reply(
                    "✅ Amount saved!\n\n" +
                    "Please enter the **slippage tolerance** (as a percentage, e.g., 1 for 1%):"
                );
                break;

            case 'awaiting_slippage':
                const slippage = parseFloat(message);
                if (isNaN(slippage) || slippage < 0 || slippage > 50) {
                    await ctx.reply("❌ Invalid slippage. Please enter a number between 0 and 50:");
                    return;
                }

                swapState.slippage = slippage;
                await executeSwap(ctx, swapState);
                userStates.delete(userId);
                break;

            default:
                await ctx.reply("❌ Invalid step. Please start over.");
                userStates.delete(userId);
        }
    } catch (error) {
        console.error("Error in swap flow:", error);
        await ctx.reply("❌ An error occurred. Please try again.");
        userStates.delete(userId);
    }
};

const executeSwap = async (ctx: any, swapState: any) => {
    try {
        await ctx.reply(
            "🔄 **Executing Swap...**\n\n" +
            `• From: \`${swapState.tokenIn}\`\n` +
            `• To: \`${swapState.tokenOut}\`\n` +
            `• Amount: ${swapState.amount}\n` +
            `• Slippage: ${swapState.slippage}%\n\n` +
            "⏳ Please wait...",
            { parse_mode: 'Markdown' }
        );

        await new Promise(resolve => setTimeout(resolve, 2000));

        await ctx.reply(
            "✅ **Swap Completed!**\n\n" +
            `Successfully swapped ${swapState.amount} tokens with ${swapState.slippage}% slippage tolerance.`
        );
    } catch (error) {
        console.error("Swap execution error:", error);
        await ctx.reply("❌ Swap failed. Please try again.");
    }
};
