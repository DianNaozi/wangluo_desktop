import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/import/schema.ts',
  out: './drizzle',
  dbCredentials: { url: './local-gallery.sqlite' }
})
