import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL || "mysql://user:password@host:port/db"; // Valor dummy para permitir 'generate'

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString,
  },
  // Adicionar o diretório de logs para o drizzle-kit generate
  verbose: true,
  strict: true,
});
