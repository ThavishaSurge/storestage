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

-- AddForeignKey
ALTER TABLE "ThemeSnapshotFile" ADD CONSTRAINT "ThemeSnapshotFile_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ThemeSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeMergeFile" ADD CONSTRAINT "ThemeMergeFile_mergeId_fkey" FOREIGN KEY ("mergeId") REFERENCES "ThemeMerge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

