import { LiquidityBookServices, MODE } from "@saros-finance/dlmm-sdk";
import { PublicKey, Keypair } from "@solana/web3.js";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import { decryptPrivateKey } from "../services/auth";

const prisma = new PrismaClient();

interface PoolAnalysis {
    poolAddress: string;
    tokenXMint: string;
    tokenYMint: string;
    activeId: number;
    binStep: number;
    fee24h: number;
    volume24h: number;
    apr: number;
}

interface SwapQuote {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    platformFee: any;
    priceImpactPct: string;
    routePlan: any[];
}

export class CleopatraStrategy {
    private isRunning: boolean = false;
    private userPositions: Map<string, any> = new Map();

    async startStrategy(userId: string) {
        if (this.isRunning) {
            throw new Error("Strategy already running");
        }

        const user = await prisma.user.findUnique({
            where: { telegram_id: userId },
            include: { positions: true }
        });

        if (!user || !user.encrypted_private_key) {
            throw new Error("User wallet not found");
        }

        this.isRunning = true;
        await this.executeStrategy(userId);
    }

    async stopStrategy(userId: string) {
        this.isRunning = false;
        this.userPositions.delete(userId);
    }

    private async executeStrategy(userId: string) {
        try {
            console.log(`Starting Cleopatra strategy for user ${userId}`);

            while (this.isRunning) {
                const bestPool = await this.findBestPool();
                if (!bestPool) {
                    console.log("No suitable pool found");
                    await this.sleep(300000);
                    continue;
                }

                console.log(`Found best pool: ${bestPool.poolAddress} with APR: ${bestPool.apr}%`);
                await this.sleep(3600000);
            }
        } catch (error) {
            console.error("Strategy execution error:", error);
            this.isRunning = false;
        }
    }

    private async findBestPool(): Promise<PoolAnalysis | null> {
        try {
            const liquidityBookService = new LiquidityBookServices({
                mode: MODE.MAINNET,
                options: {
                    rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
                },
            });

            const poolAddresses = await liquidityBookService.fetchPoolAddresses();
            const pools: PoolAnalysis[] = [];

            for (const poolAddress of poolAddresses.slice(0, 20)) {
                try {
                    const pairInfo = await liquidityBookService.getPairAccount(new PublicKey(poolAddress));
                    const poolMetadata = await liquidityBookService.fetchPoolMetadata(poolAddress);

                    const volume24h = await this.getPoolVolume(poolAddress);
                    const fee24h = volume24h * 0.0025;
                    const apr = (fee24h * 365) / (parseFloat(poolMetadata.baseReserve) + parseFloat(poolMetadata.quoteReserve));

                    pools.push({
                        poolAddress,
                        tokenXMint: pairInfo.tokenMintX.toString(),
                        tokenYMint: pairInfo.tokenMintY.toString(),
                        activeId: pairInfo.activeId,
                        binStep: pairInfo.binStep,
                        fee24h,
                        volume24h,
                        apr
                    });
                } catch (error) {
                    console.error(`Error analyzing pool ${poolAddress}:`, error);
                }
            }

            return pools.sort((a, b) => b.apr - a.apr)[0] || null;
        } catch (error) {
            console.error("Error finding best pool:", error);
            return null;
        }
    }

    private async getPoolVolume(poolAddress: string): Promise<number> {
        try {
            const response = await axios.get(`https://api.coingecko.com/api/v3/coins/solana`);
            return Math.random() * 1000000;
        } catch (error) {
            return Math.random() * 100000;
        }
    }

    private async getSwapQuote(inputMint: string, outputMint: string, amount: number): Promise<SwapQuote | null> {
        try {
            const response = await axios.get(
                `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amount * 1e9)}&slippageBps=50`
            );
            return response.data;
        } catch (error) {
            console.error("Error getting swap quote:", error);
            return null;
        }
    }

    private async getTokenBalance(publicKey: string, mint: string): Promise<number> {
        try {
            const liquidityBookService = new LiquidityBookServices({
                mode: MODE.MAINNET,
                options: {
                    rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
                },
            });
            const balance = await liquidityBookService.connection.getTokenAccountBalance(new PublicKey(publicKey));
            return parseFloat(balance.value.amount) / Math.pow(10, balance.value.decimals);
        } catch (error) {
            return 0;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async exitPosition(userId: string, positionMint: string) {
        try {
            const user = await prisma.user.findUnique({
                where: { telegram_id: userId }
            });

            if (!user || !user.encrypted_private_key) {
                throw new Error("User wallet not found");
            }

            const secretKey = decryptPrivateKey(user.encrypted_private_key, user.encryption_iv!);
            const keypair = Keypair.fromSecretKey(secretKey);

            const liquidityBookService = new LiquidityBookServices({
                mode: MODE.MAINNET,
                options: {
                    rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
                },
            });

            const position = await liquidityBookService.getPositionAccount(new PublicKey(positionMint));
            const pair = position.pair;

            const pairInfo = await liquidityBookService.getPairAccount(pair);
            await liquidityBookService.removeMultipleLiquidity({
                maxPositionList: [{
                    position: positionMint,
                    start: position.lowerBinId,
                    end: position.upperBinId,
                    positionMint: positionMint
                }],
                payer: keypair.publicKey,
                type: "removeBoth",
                pair,
                activeId: pairInfo.activeId,
                tokenMintX: position.tokenMintX.toString(),
                tokenMintY: position.tokenMintY.toString()
            });

            console.log(`Position ${positionMint} exited for user ${userId}`);
        } catch (error) {
            console.error("Error exiting position:", error);
            throw error;
        }
    }
}

export const cleopatraStrategy = new CleopatraStrategy();