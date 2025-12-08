-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parrandaId" TEXT,
    "nombre" TEXT NOT NULL,
    "zona" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Client" ("createdAt", "id", "nombre", "parrandaId", "zona") SELECT "createdAt", "id", "nombre", "parrandaId", "zona" FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";
CREATE UNIQUE INDEX "Client_parrandaId_key" ON "Client"("parrandaId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
