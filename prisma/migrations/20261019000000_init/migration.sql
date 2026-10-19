-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "payload" TEXT NOT NULL,
    "result" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "themeName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeSnapshotFile" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "checksum" TEXT,
    "size" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "encoding" TEXT NOT NULL,
    "body" TEXT,

    CONSTRAINT "ThemeSnapshotFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeLink" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "workingThemeId" TEXT NOT NULL,
    "sourceThemeId" TEXT NOT NULL,
    "baselineSnapshotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeMerge" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'same-store',
    "liveShop" TEXT NOT NULL,
    "targetShop" TEXT NOT NULL,
    "pairId" TEXT,
    "liveThemeId" TEXT NOT NULL,
    "liveThemeName" TEXT NOT NULL,
    "targetThemeId" TEXT NOT NULL,
    "targetThemeName" TEXT NOT NULL,
    "baselineSnapshotId" TEXT,
    "mode" TEXT NOT NULL,
    "forkTime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'analyzing',
    "jobId" TEXT,
    "summary" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeMerge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeMergeFile" (
    "id" TEXT NOT NULL,
    "mergeId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "presence" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT true,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "baseBody" TEXT,
    "liveBody" TEXT,
    "targetBody" TEXT,
    "encoding" TEXT NOT NULL DEFAULT 'text',
    "mergeData" TEXT,
    "resultBody" TEXT,

    CONSTRAINT "ThemeMergeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairingCode" (
    "code" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairingCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "StorePair" (
    "id" TEXT NOT NULL,
    "stagingShop" TEXT NOT NULL,
    "liveShop" TEXT NOT NULL,
    "baselineSnapshotId" TEXT,
    "clonedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorePair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSnapshot" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "resourceTypes" TEXT NOT NULL,
    "themeSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSnapshotItem" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "gid" TEXT,
    "title" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "transfer" TEXT,

    CONSTRAINT "StoreSnapshotItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCompare" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "jobId" TEXT,
    "baselineId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreCompare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCompareItem" (
    "id" TEXT NOT NULL,
    "compareId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "conflicts" TEXT,
    "decisions" TEXT,
    "baseData" TEXT,
    "stagingData" TEXT,
    "liveData" TEXT,
    "mergedData" TEXT,
    "transfer" TEXT,

    CONSTRAINT "StoreCompareItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "compareId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "prepushSnapshotId" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionItem" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "liveGid" TEXT,
    "createdGid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_shop_createdAt_idx" ON "Job"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ThemeSnapshot_shop_themeId_createdAt_idx" ON "ThemeSnapshot"("shop", "themeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeSnapshotFile_snapshotId_filename_key" ON "ThemeSnapshotFile"("snapshotId", "filename");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeLink_shop_workingThemeId_key" ON "ThemeLink"("shop", "workingThemeId");

-- CreateIndex
CREATE INDEX "ThemeMerge_shop_createdAt_idx" ON "ThemeMerge"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeMergeFile_mergeId_filename_key" ON "ThemeMergeFile"("mergeId", "filename");

-- CreateIndex
CREATE UNIQUE INDEX "StorePair_stagingShop_key" ON "StorePair"("stagingShop");

-- CreateIndex
CREATE INDEX "StorePair_liveShop_idx" ON "StorePair"("liveShop");

-- CreateIndex
CREATE INDEX "StoreSnapshot_pairId_kind_createdAt_idx" ON "StoreSnapshot"("pairId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSnapshotItem_snapshotId_type_key_key" ON "StoreSnapshotItem"("snapshotId", "type", "key");

-- CreateIndex
CREATE INDEX "StoreCompare_pairId_createdAt_idx" ON "StoreCompare"("pairId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCompareItem_compareId_type_key_key" ON "StoreCompareItem"("compareId", "type", "key");

-- CreateIndex
CREATE INDEX "Promotion_pairId_createdAt_idx" ON "Promotion"("pairId", "createdAt");

-- AddForeignKey
ALTER TABLE "ThemeSnapshotFile" ADD CONSTRAINT "ThemeSnapshotFile_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ThemeSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeMergeFile" ADD CONSTRAINT "ThemeMergeFile_mergeId_fkey" FOREIGN KEY ("mergeId") REFERENCES "ThemeMerge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSnapshotItem" ADD CONSTRAINT "StoreSnapshotItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "StoreSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCompareItem" ADD CONSTRAINT "StoreCompareItem_compareId_fkey" FOREIGN KEY ("compareId") REFERENCES "StoreCompare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

