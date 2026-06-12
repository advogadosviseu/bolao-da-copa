// ============================================================
//  CONFIGURAÇÃO — preencha com os dados do SEU projeto Supabase
// ------------------------------------------------------------
//  Onde achar: painel do Supabase > Project Settings > Data API
//   - URL          -> "Project URL"
//   - ANON_KEY     -> "Project API keys" > "anon public"
//
//  Pode commitar estes dois valores no GitHub: a "anon key" é
//  pública por natureza. A segurança real vem das políticas
//  RLS definidas em sql/schema.sql.
// ============================================================

export const SUPABASE_URL  = "https://zjplrfkmddbmklwgaqan.supabase.co";       // ex.: https://abcd1234.supabase.co
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqcGxyZmttZGRibWtsd2dhcWFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNDcxNDIsImV4cCI6MjA5NjgyMzE0Mn0.hYmYBdj7JJFSbzschZl31j7FCuV2z03JmLvBK8YJiIk";

// Nome do bolão (aparece no cabeçalho)
export const APP_NAME = "Bolão da Copa";
export const APP_EDITION = "2026";

// Tabela de pontuação (apenas exibição — a contagem oficial está no SQL)
export const SCORING = [
  { label: "Placar exato", points: 10 },
  { label: "Resultado certo (placar errado)", points: 5 },
  { label: "Errou", points: 0 },
];
