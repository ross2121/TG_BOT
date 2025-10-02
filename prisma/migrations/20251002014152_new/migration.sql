/*
  Warnings:

  - A unique constraint covering the columns `[telegram_id]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "public"."Position" DROP CONSTRAINT "Position_userId_fkey";

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "initialTokenAAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "initialTokenAPriceUSD" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "initialTokenBAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "initialTokenBPriceUSD" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "lastILWarningPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "encrypted_private_key" TEXT,
ADD COLUMN     "encryption_iv" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_telegram_id_key" ON "User"("telegram_id");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
