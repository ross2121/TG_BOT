import { Keypair } from "@solana/web3.js";
import crypto from "crypto";
import bs58 from "bs58";

const algorithm = 'aes-256-cbc';

export const generateWallet = () => {
    const keypair = Keypair.generate();
    return {
        publicKey: keypair.publicKey.toString(),
        secretKey: keypair.secretKey,
    };
};

export const encryptPrivateKey = (secretKey: Uint8Array): { encrypted: string, iv: string } => {
    const key = crypto.scryptSync(process.env.CRYPTO_SECRET || 'your-secret-key-change-this', 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    const secretKeyBase58 = bs58.encode(secretKey);
    
    let encrypted = cipher.update(secretKeyBase58, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
        encrypted,
        iv: iv.toString('hex')
    };
};

export const decryptPrivateKey = (encrypted: string, ivHex: string): Uint8Array => {
    const key = crypto.scryptSync(process.env.CRYPTO_SECRET || 'your-secret-key-change-this', 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return bs58.decode(decrypted);
};
