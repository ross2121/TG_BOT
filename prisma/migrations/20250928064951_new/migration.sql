/*
  Warnings:

  - Added the required column `telegram_id` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "telegram_id" TEXT NOT NULL;
