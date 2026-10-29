-- CreateEnum
CREATE TYPE "RepeatInterval" AS ENUM ('NONE', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- AlterEnum
ALTER TYPE "SplitMethod" ADD VALUE 'ADJUSTMENT';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "recurringSourceId" TEXT,
ADD COLUMN     "repeatCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "repeatInterval" "RepeatInterval" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "repeatNextDate" DATE;

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "directKey" TEXT,
ADD COLUMN     "simplifyDebts" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Expense_repeatNextDate_idx" ON "Expense"("repeatNextDate");

-- CreateIndex
CREATE INDEX "Expense_recurringSourceId_idx" ON "Expense"("recurringSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_directKey_key" ON "Group"("directKey");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringSourceId_fkey" FOREIGN KEY ("recurringSourceId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

