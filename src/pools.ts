import { LiquidityBookServices, MODE } from "@saros-finance/dlmm-sdk";
import { PublicKey, Connection } from "@solana/web3.js";
import axios from "axios";

export interface PoolInfo {
    name: string;
    pairAddress: string;
    tokenX: {
        mint: string;
        symbol: string;
        decimals: number;
    };
    tokenY: {
        mint: string;
        symbol: string;
        decimals: number;
    };
}

// Cache for pools
let poolsCache: PoolInfo[] | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Fallback popular pools if API fetch fails
export const POPULAR_POOLS: PoolInfo[] = [
    {
        name: "SOL/USDC",
        pairAddress: "Cpjn7PkhKs5VMJ1YAb2ebS5AEGXUgRsxQHt38U8aefK3",
        tokenX: {
            mint: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
            decimals: 9
        },
        tokenY: {
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            symbol: "USDC",
            decimals: 6
        }
    },
    {
        name: "C98/USDC",
        pairAddress: "9P3N4QxjMumpTNNdvaNNskXu2t7VHMMXtePQB72kkSAk",
        tokenX: {
            mint: "C98A4nkJXhpVZNAZdHUA95RpTF3T4whtQubL3YobiUX9",
            symbol: "C98",
            decimals: 6
        },
        tokenY: {
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            symbol: "USDC",
            decimals: 6
        }
    },
    {
        name: "BTC/USDC",
        pairAddress: "YOUR_BTC_USDC_PAIR_ADDRESS_HERE",
        tokenX: {
            mint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
            symbol: "BTC",
            decimals: 8
        },
        tokenY: {
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            symbol: "USDC",
            decimals: 6
        }
    }
    // Add more pools as needed
];

// Fetch pools from Saros API or on-chain
export const fetchPools = async (): Promise<PoolInfo[]> => {
    // Check cache
    const now = Date.now();
    if (poolsCache && (now - lastFetchTime) < CACHE_DURATION) {
        return poolsCache;
    }

    try {
        // Try to fetch from Saros API (replace with actual API endpoint if available)
        // For now, we'll use a combination of popular pools and on-chain data
        const liquidityBookService = new LiquidityBookServices({
            mode: MODE.MAINNET,
            options: {
                rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
            },
        });

        // Enhance popular pools with live data
        const enhancedPools: PoolInfo[] = [];
        
        for (const pool of POPULAR_POOLS) {
            try {
                const pairInfo = await liquidityBookService.getPairAccount(new PublicKey(pool.pairAddress));
                enhancedPools.push({
                    ...pool,
                    name: `${pool.tokenX.symbol}/${pool.tokenY.symbol}`,
                });
            } catch (error) {
                // If fetch fails, use the pool as-is
                enhancedPools.push(pool);
            }
        }

        poolsCache = enhancedPools;
        lastFetchTime = now;
        return enhancedPools;
        
    } catch (error) {
        console.error("Error fetching pools:", error);
        // Return fallback pools
        return POPULAR_POOLS;
    }
};

export const getPoolByIndex = async (index: number): Promise<PoolInfo | undefined> => {
    const pools = await fetchPools();
    return pools[index];
};

export const getPoolsList = async (): Promise<string> => {
    const pools = await fetchPools();
    return pools.map((pool, index) => 
        `${index + 1}️⃣ ${pool.name}`
    ).join('\n');
};

