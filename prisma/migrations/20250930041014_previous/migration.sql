/*
  Warnings:

  - Added the required column `Market` to the `Position` table without a default value. This is not possible if the table is not empty.
  - Added the required column `Status` to the `Position` table without a default value. This is not possible if the table is not empty.
  - Added the required column `public_key` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."Status" AS ENUM ('Active', 'UnActive');

-- AlterTable
ALTER TABLE "public"."Position" ADD COLUMN     "Market" TEXT NOT NULL,
ADD COLUMN     "Previous" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "Status" "public"."Status" NOT NULL;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "public_key" TEXT NOT NULL;
