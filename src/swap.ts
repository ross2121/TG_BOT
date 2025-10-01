import { PublicKey, Transaction, Keypair } from "@solana/web3.js";
import { LiquidityBookServices, MODE } from "@saros-finance/dlmm-sdk";
import dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

export interface SwapParams {
    amountFrom: number;
    tokenMintX: string;
    tokenMintY: string;
    tokenBaseDecimal: number;
    tokenQuoteDecimal: number;
    pairAddress: string;
    slippage: number;
    walletKeypair: Keypair;
    swapForY: boolean; // true = X to Y, false = Y to X
}

export const getSwapQuote = async (params: SwapParams) => {
    const liquidityBookServices = new LiquidityBookServices({
        mode: MODE.MAINNET,
        options: {
            rpcUrl: RPC_URL,
        },
    });

    const quoteData = await liquidityBookServices.getQuote({
        amount: BigInt(params.amountFrom),
        isExactInput: true,
        swapForY: params.swapForY,
        pair: new PublicKey(params.pairAddress),
        tokenBase: new PublicKey(params.tokenMintX),
        tokenQuote: new PublicKey(params.tokenMintY),
        tokenBaseDecimal: params.tokenBaseDecimal,
        tokenQuoteDecimal: params.tokenQuoteDecimal,
        slippage: params.slippage
    });

    return quoteData;
};

export const executeSwap = async (params: SwapParams) => {
    const liquidityBookServices = new LiquidityBookServices({
        mode: MODE.MAINNET,
        options: {
            rpcUrl: RPC_URL,
        },
    });

    // Get quote first
    const quoteData = await getSwapQuote(params);
    const { amountIn, amountOut, priceImpact, amount, otherAmountOffset } = quoteData;

    console.log(`Swap Quote:`);
    console.log(`- Amount In: ${amountIn}`);
    console.log(`- Amount Out: ${amountOut}`);
    console.log(`- Price Impact: ${priceImpact}%`);

    // Create swap transaction
    const transaction = await liquidityBookServices.swap({
        amount,
        tokenMintX: new PublicKey(params.tokenMintX),
        tokenMintY: new PublicKey(params.tokenMintY),
        otherAmountOffset,
        hook: new PublicKey(liquidityBookServices.hooksConfig),
        isExactInput: true,
        swapForY: params.swapForY,
        pair: new PublicKey(params.pairAddress),
        payer: params.walletKeypair.publicKey
    });

    // Sign transaction
    transaction.sign(params.walletKeypair);

    // Send transaction
    const signature = await liquidityBookServices.connection.sendRawTransaction(
        transaction.serialize(),
        {
            skipPreflight: false,
            preflightCommitment: "confirmed",
        }
    );

    console.log(`Transaction sent: ${signature}`);

    // Confirm transaction
    const { blockhash, lastValidBlockHeight } = await liquidityBookServices.connection.getLatestBlockhash();
    await liquidityBookServices.connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
    });

    console.log(`Transaction confirmed: ${signature}`);

    return {
        signature,
        amountIn,
        amountOut,
        priceImpact
    };
};

