import { Context } from "telegraf";
import { PrismaClient } from "@prisma/client";
import { Keypair, PublicKey } from "@solana/web3.js";
import { executeSwap, getSwapQuote } from "./swap";
import { decryptPrivateKey } from "./auth";
import { LiquidityBookServices, MODE } from "@saros-finance/dlmm-sdk";
import axios from "axios";

const prisma = new PrismaClient();

interface SwapState {
    step: 'awaiting_token_from' | 'awaiting_token_to' | 'awaiting_pair' | 'awaiting_amount' | 'awaiting_confirmation';
    tokenMintFrom?: string;
    tokenMintTo?: string;
    tokenFromSymbol?: string;
    tokenToSymbol?: string;
    tokenFromDecimals?: number;
    tokenToDecimals?: number;
    pairAddress?: string;
    amount?: number;
    quoteData?: any;
}

const getTokenInfo = async (mintAddress: string) => {
    try {
        const response = await axios.get(`https://price.jup.ag/v4/price?ids=${mintAddress}`);
        const data = response.data.data[mintAddress];
        return {
            symbol: data?.symbol || 'UNKNOWN',
            decimals: data?.decimals || 9
        };
    } catch (error) {
        return { symbol: 'UNKNOWN', decimals: 9 };
    }
};

export const handleSwapCommand = async (ctx: Context, userStates: Map<number, any>) => {
    const userId = ctx.from!.id;
    const user = await prisma.user.findUnique({
        where: { telegram_id: userId.toString() }
    });
    if (!user || !user.encrypted_private_key) {
        await ctx.reply("❌ You need to create a wallet first! Use the '🔐 Create New Wallet' button.");
        return;
    }
    userStates.set(userId, { swapState: { step: 'awaiting_token_from' } });
    await ctx.reply("🔄 **Swap Setup**\n\n📍 Enter the mint address of the token you want to SELL:\n\nExample: So11111111111111111111111111111111111111112 (SOL)");
};

export const handleSwapFlow = async (ctx: Context, message: string, userId: number, userStates: Map<number, any>) => {
    const userState = userStates.get(userId);
    const swapState: SwapState = userState.swapState || {};
    try {
        switch (swapState.step) {
            case 'awaiting_token_from':
                try { new PublicKey(message); } catch { await ctx.reply("❌ Invalid mint address. Please enter a valid Solana public key:"); return; }
                await ctx.reply("⏳ Fetching token info...");
                const tokenFromInfo = await getTokenInfo(message);
                swapState.tokenMintFrom = message;
                swapState.tokenFromSymbol = tokenFromInfo.symbol;
                swapState.tokenFromDecimals = tokenFromInfo.decimals;
                swapState.step = 'awaiting_token_to';
                await ctx.reply(`✅ Token from: **${tokenFromInfo.symbol}**\n\`${message}\`\n\n📍 Now enter the mint address of the token you want to BUY:`, { parse_mode: 'Markdown' });
                break;
            case 'awaiting_token_to':
                try { new PublicKey(message); } catch { await ctx.reply("❌ Invalid mint address. Please enter a valid Solana public key:"); return; }
                await ctx.reply("⏳ Fetching token info...");
                const tokenToInfo = await getTokenInfo(message);
                swapState.tokenMintTo = message;
                swapState.tokenToSymbol = tokenToInfo.symbol;
                swapState.tokenToDecimals = tokenToInfo.decimals;
                swapState.step = 'awaiting_pair';
                await ctx.reply(`✅ Token to: **${tokenToInfo.symbol}**\n\`${message}\`\n\n📍 Enter the pool/pair address for ${swapState.tokenFromSymbol}/${tokenToInfo.symbol}:`, { parse_mode: 'Markdown' });
                break;
            case 'awaiting_pair':
                try { new PublicKey(message); } catch { await ctx.reply("❌ Invalid pair address. Please enter a valid Solana public key:"); return; }
                try {
                    const liquidityBookService = new LiquidityBookServices({ mode: MODE.MAINNET, options: { rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com" } });
                    await liquidityBookService.getPairAccount(new PublicKey(message));
                    swapState.pairAddress = message;
                    swapState.step = 'awaiting_amount';
                    await ctx.reply(`✅ Pool verified!\n\n💰 Enter the amount of **${swapState.tokenFromSymbol}** you want to swap:\n(e.g., 1 = 1 ${swapState.tokenFromSymbol})`, { parse_mode: 'Markdown' });
                } catch { await ctx.reply("❌ Invalid pair address or pair doesn't exist. Please check and try again:"); }
                break;
            case 'awaiting_amount':
                const amount = parseFloat(message);
                if (isNaN(amount) || amount <= 0) { await ctx.reply("❌ Invalid amount. Please enter a valid number:"); return; }
                swapState.amount = Math.floor(amount * Math.pow(10, swapState.tokenFromDecimals!));
                await ctx.reply("⏳ Getting quote...");
                const quoteData = await getSwapQuote({ amountFrom: swapState.amount!, tokenMintX: swapState.tokenMintFrom!, tokenMintY: swapState.tokenMintTo!, tokenBaseDecimal: swapState.tokenFromDecimals!, tokenQuoteDecimal: swapState.tokenToDecimals!, pairAddress: swapState.pairAddress!, slippage: 0.5, walletKeypair: null as any, swapForY: true });
                swapState.quoteData = quoteData;
                swapState.step = 'awaiting_confirmation';
                await ctx.reply(`📊 **Swap Quote:**\n\n📤 You send: ${amount} ${swapState.tokenFromSymbol}\n📥 You receive: ~${(Number(quoteData.amountOut) / Math.pow(10, swapState.tokenToDecimals!)).toFixed(6)} ${swapState.tokenToSymbol}\n📈 Price Impact: ${quoteData.priceImpact}%\n\n✅ Reply 'confirm' to execute\n❌ Reply 'cancel' to abort`, { parse_mode: 'Markdown' });
                break;
            case 'awaiting_confirmation':
                const choice = message.toLowerCase();
                if (choice === 'cancel') { await ctx.reply("❌ Swap cancelled."); userStates.delete(userId); return; }
                if (choice !== 'confirm') { await ctx.reply("Please reply 'confirm' or 'cancel':"); return; }
                await ctx.reply("⏳ Executing swap...");
                const user = await prisma.user.findUnique({ where: { telegram_id: userId.toString() } });
                if (!user || !user.encrypted_private_key || !user.encryption_iv) { await ctx.reply("❌ Error: Wallet not found."); userStates.delete(userId); return; }
                const secretKey = decryptPrivateKey(user.encrypted_private_key, user.encryption_iv);
                const walletKeypair = Keypair.fromSecretKey(secretKey);
                
                try {
                    const result = await executeSwap({ amountFrom: swapState.amount!, tokenMintX: swapState.tokenMintFrom!, tokenMintY: swapState.tokenMintTo!, tokenBaseDecimal: swapState.tokenFromDecimals!, tokenQuoteDecimal: swapState.tokenToDecimals!, pairAddress: swapState.pairAddress!, slippage: 0.5, walletKeypair, swapForY: true });
                    await ctx.reply(`✅ **Swap Successful!**\n\n🔗 Signature: \`${result.signature}\`\n📤 Sent: ${swapState.amount! / Math.pow(10, swapState.tokenFromDecimals!)} ${swapState.tokenFromSymbol}\n📥 Received: ~${(Number(result.amountOut) / Math.pow(10, swapState.tokenToDecimals!)).toFixed(6)} ${swapState.tokenToSymbol}\n\nView on Solscan: https://solscan.io/tx/${result.signature}`, { parse_mode: 'Markdown' });
                    userStates.delete(userId);
                } catch (swapError: any) {
                    const errorMessage = swapError?.message || '';
                    
                    // Check for insufficient funds error
                    if (errorMessage.includes('Simulation failed') || 
                        errorMessage.includes('Attempt to debit an account') || 
                        errorMessage.includes('insufficient funds') ||
                        errorMessage.includes('no record of a prior credit')) {
                        
                        await ctx.reply(
                            `❌ **Insufficient Funds**\n\n` +
                            `Your wallet doesn't have enough balance to complete this swap.\n\n` +
                            `💳 **Your Wallet Address:**\n\`${walletKeypair.publicKey.toString()}\`\n\n` +
                            `Please fund your wallet with:\n` +
                            `• ${swapState.tokenFromSymbol} (to swap)\n` +
                            `• SOL (for transaction fees)\n\n` +
                            `You can send tokens to the address above.`,
                            { parse_mode: 'Markdown' }
                        );
                    } else {
                        // Other swap errors
                        await ctx.reply(`❌ Swap failed: ${errorMessage}`);
                    }
                    userStates.delete(userId);
                }
                break;
        }
        userState.swapState = swapState;
    } catch (error) {
        console.error("Swap error:", error);
        await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        userStates.delete(userId);
    }
};
