export interface UserState {
    step: string;
    pool?: string;
    swapState?: SwapState;
}

export interface SwapState {
    step: string;
    tokenIn?: string;
    tokenOut?: string;
    amount?: number;
    slippage?: number;
}

export interface PositionData {
    mint: string;
    lowerId: string;
    upperId: string;
    Previous: number;
    Market: string;
    Status: string;
    initialTokenAAmount?: number;
    initialTokenBAmount?: number;
    initialTokenAPriceUSD?: number;
    initialTokenBPriceUSD?: number;
    lastILWarningPercent?: number;
    userId: string;
}
