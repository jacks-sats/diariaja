# 🔒 LGPD — Checklist de conformidade DiáriaJá

**Última revisão:** 2026-05-27
**Base legal principal:** Lei nº 13.709/2018 (LGPD)
**Responsável:** Jackson dos Santos da Silva (controlador)
**Encarregado (DPO):** ⚠️ A nomear formalmente — ver Pendência #1.

---

## 1. Mapeamento de tratamento (Art. 5º, 6º, 7º LGPD)

| Campo | Base legal | Finalidade | Retenção |
|---|---|---|---|
| nome, e-mail | Execução de contrato (Art. 7º V) | Identidade + comunicação | Enquanto conta ativa |
| CPF / CNPJ | Execução de contrato + prevenção a fraude (Art. 7º V, IX) | Anti-duplicidade + identidade fiscal | Enquanto conta ativa |
| Telefone | Execução de contrato | Contato após match | Enquanto conta ativa |
| Foto perfil | Consentimento (Art. 7º I) | Aumentar confiança no marketplace | Enquanto conta ativa |
| Endereço (CEP + rua) | Execução de contrato | Cálculo de distância e match local | Enquanto conta ativa |
| RG/CNH (PDF/imagem) | Consentimento (Art. 7º I) — KYC opcional | Subir nível de confiança | Indefinido até user remover via "Excluir conta" |
| Certidão antecedentes (PDF) | Consentimento expresso revogável (Art. 11 II "b" — dado sensível) | Selo extra de confiança | ⚠️ Pendente: expurgo 90 dias automático (não rotina ainda) |
| Geolocalização | Execução de contrato | Match por proximidade | Cálculo on-the-fly, não armazena GPS bruto |
| Mensagens chat | Execução de contrato | Comunicação após match | Enquanto diária existir |
| Termos aceitos (versão + timestamp) | Cumprimento de obrigação legal (Art. 7º II) | Prova de consentimento | Imutável (Art. 8º §2º) |

---

## 2. Direitos do titular (Art. 18)

| Direito | Como exercer | Status |
|---|---|---|
| Confirmação (I) | Login no app | ✅ |
| Acesso (II) | Perfil + Editar Perfil | ✅ |
| Correção (III) | Editar Perfil | ✅ |
| Anonimização/bloqueio/eliminação (IV) | Configurações → Excluir conta | ✅ via `delete-user` Edge Function |
| **Portabilidade (V)** | Endpoint exportar dados | ❌ **Não implementado** — declarado nos Termos mas falta o endpoint. Pendência #2 |
| Eliminação após consentimento (VI) | Configurações → Excluir conta | ✅ (cascade em todas as tabelas + buckets) |
| Informação sobre compartilhamento (VII) | Termos de Uso, cláusula 5 | ✅ |
| Revogação consentimento (IX) | Não há mecanismo dedicado por finalidade | ⚠️ Granular pendente |

---

## 3. Coleta mínima — checklist de campos

✅ Não coletamos: raça, religião, opinião política, orientação sexual, dado biométrico, contato de terceiros.
✅ Não rastreamos via SDKs (sem GA, sem Pixel, sem Mixpanel, sem Sentry).
✅ Sem cross-site tracking (sem cookies de terceiros).
⚠️ Antecedentes criminais = dado sensível (Art. 11). Hoje: consentimento expresso obtido via upload deliberado + termo na tela. Manter assim.

---

## 4. Segurança técnica (Art. 46)

| Controle | Status |
|---|---|
| TLS em trânsito | ✅ (Vercel + HSTS) |
| RLS no banco | ✅ |
| Senha em hash | ✅ (Supabase Auth — bcrypt) |
| Documentos em bucket privado | ✅ (`documentos`, `antecedentes`) |
| Acesso admin com `is_admin` server-side | ✅ |
| Trilha de auditoria de acesso admin a KYC | ❌ **Pendente** #3 — admin pode ver doc sem deixar rastro |
| Logs sem PII | ⚠️ Parcial — Edge Functions logam `userId` em `console.error` |
| Backup do banco | ✅ (Supabase Free retém 7 dias) |

---

## 5. Compartilhamento com terceiros (Art. 26)

| Provedor | O que recebe | Finalidade | Localização |
|---|---|---|---|
| Supabase (Auth/DB/Storage) | Todos os dados | Hospedagem da plataforma | EUA (us-east) — informar nos termos |
| Vercel | Logs de acesso (IP, user-agent) | Hospedagem frontend | EUA |
| Mercado Pago | nome, e-mail, valor da transação | Processamento do unlock R$1 + assinaturas | Brasil |
| Groq | Texto da pergunta do usuário (sem PII identificadora) | Chatbot Jájá | EUA |
| ViaCEP / BrasilAPI | CEP digitado | Conversão CEP → endereço | Brasil |
| OpenStreetMap / Nominatim | Coordenadas | Mapa + reverse geocoding | Reino Unido (OSM Foundation) |

⚠️ **Pendente**: incluir essa tabela na Política de Privacidade visível ao usuário (hoje a política só menciona "Supabase" genericamente).

---

## 6. Pendências LGPD priorizadas

| # | Item | Prioridade | Esforço | Quem resolve |
|---|---|---|---|---|
| 1 | Nomear Encarregado (DPO) formalmente + e-mail `dpo@diariaja.com.br` | **Alta** | Decisão executiva | Owner |
| 2 | Endpoint Edge Function `export-user-data` (zip JSON + arquivos do user) | **Alta** | 4h | Dev |
| 3 | Trilha de auditoria de acesso a KYC (tabela `kyc_acessos_log`) | **Alta** | 3h | Dev |
| 4 | Rotina `pg_cron` diária: expurgar antecedentes >90 dias | **Média** | 1h | Dev |
| 5 | Pseudonimizar `userId` em `console.error` das Edge Functions | **Média** | 2h | Dev |
| 6 | Política de Privacidade revisada com base legal por campo + tabela de provedores | **Média** | Advogado + dev | Advogado |
| 7 | Modal de consentimento granular para antecedentes (revogável) | **Baixa** | 2h | Dev |

---

## 7. Em caso de incidente de dados pessoais (Art. 48)

Procedimento detalhado em [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md). Resumo:
1. Conter (revogar credenciais comprometidas, fechar acesso).
2. Avaliar impacto (quantos titulares, que dados, que risco).
3. Notificar ANPD em até 72h ÚTEIS após conhecimento (formulário em gov.br/anpd).
4. Comunicar titulares se houver risco relevante.
5. Documentar incidente e medidas tomadas.

---

## 8. Documentos legais externos necessários

🔴 **A produzir via advogado especializado:**
- Política de Privacidade completa (substituir a tela atual)
- Termos de Uso revisados (cláusulas atuais foram redigidas internamente)
- Contrato de operador com Supabase (Data Processing Agreement)
- Aviso de compartilhamento internacional (Supabase/Groq/Vercel nos EUA)
