import { useState } from "react";

// Tela de Política de Privacidade (LGPD). Texto estático + acordeão.
// Extraída do App.tsx e carregada sob demanda (React.lazy) — sai do chunk
// principal. Navegação de volta injetada via prop (antes era setTela direto).
export default function PoliticaPrivacidade({ onVoltar }: { onVoltar: () => void }) {
  const secoes = [
    {
      titulo: "1. Quem somos",
      corpo: "A DiáriaJá é uma plataforma digital de anúncios de oportunidades de serviços, operada por [Razão Social], CNPJ [nº], com sede em Campo Grande — MS. A plataforma não participa da execução do serviço — apenas disponibiliza ferramentas para publicação de anúncios e conexão entre usuários. A relação entre anunciante e prestador é independente e autônoma. Contato: suporte@diariaja.com.br.",
    },
    {
      titulo: "2. Dados que coletamos",
      corpo: "Coletamos os seguintes dados pessoais:\n\n• Nome completo\n• E-mail e senha (criptografada)\n• CPF ou CNPJ (armazenado de forma privada, nunca exibido publicamente)\n• Número de telefone\n• Foto de perfil\n• Localização geográfica (GPS, apenas com seu consentimento)\n• Histórico de diárias, candidaturas e avaliações\n• Mensagens trocadas no chat\n• Dados de portfólio (fotos de trabalhos anteriores)",
    },
    {
      titulo: "3. Para que usamos seus dados",
      corpo: "Seus dados são utilizados exclusivamente para:\n\n• Criar e autenticar sua conta\n• Exibir seu perfil para outros usuários da plataforma\n• Conectar anunciantes e prestadores autônomos\n• Calcular score de confiança e nível de gamificação\n• Enviar notificações relacionadas às suas diárias\n• Cumprir obrigações legais e regulatórias",
    },
    {
      titulo: "4. Compartilhamento de dados",
      corpo: "NÃO vendemos nem compartilhamos seus dados pessoais com terceiros para fins comerciais.\n\nCompartilhamos dados apenas:\n• Com a Supabase (infraestrutura segura, criptografada)\n• Com outros usuários da plataforma, apenas as informações que você tornou públicas no seu perfil\n• Quando exigido por lei ou ordem judicial",
    },
    {
      titulo: "5. Armazenamento e segurança",
      corpo: "Seus dados são armazenados na infraestrutura da Supabase (AWS/EUA) com:\n\n• Criptografia em trânsito (HTTPS/TLS)\n• Autenticação segura (JWT)\n• Políticas de acesso por linha (Row Level Security)\n• Backups automáticos\n\nSenhas nunca são armazenadas em texto claro.",
    },
    {
      titulo: "6. Seus direitos (LGPD — Lei 13.709/2018)",
      corpo: "Você tem direito a:\n\n• Acessar seus dados pessoais\n• Corrigir dados incorretos ou desatualizados\n• Solicitar a exclusão dos seus dados (\"direito ao esquecimento\")\n• Portabilidade dos seus dados\n• Revogar o consentimento a qualquer momento\n• Reclamar à ANPD (Autoridade Nacional de Proteção de Dados)\n\nPara exercer esses direitos: suporte@diariaja.com.br",
    },
    {
      titulo: "7. Retenção de dados",
      corpo: "Mantemos seus dados enquanto sua conta estiver ativa. Após a exclusão da conta, os dados são removidos em até 30 dias, exceto quando a retenção for obrigatória por lei (ex.: registros fiscais por 5 anos).",
    },
    {
      titulo: "8. Cookies e rastreamento",
      corpo: "O DiáriaJá utiliza localStorage do navegador apenas para preferências locais (dark mode, dados de sessão). Não utilizamos cookies de rastreamento de terceiros ou anúncios.",
    },
    {
      titulo: "9. Menores de idade",
      corpo: "O DiáriaJá é destinado exclusivamente a maiores de 18 anos. Não coletamos intencionalmente dados de menores. Caso identifiquemos cadastro de menor, a conta será removida imediatamente.",
    },
    {
      titulo: "10. Alterações nesta política",
      corpo: "Esta política pode ser atualizada periodicamente. Notificaremos usuários sobre mudanças relevantes pelo app. A data da última atualização está no rodapé desta página.",
    },
  ];
  const [secaoAberta, setSecaoAberta] = useState<number | null>(null);
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg-app,#f0f2f5)", fontFamily:"Inter, system-ui, sans-serif", maxWidth:480, margin:"0 auto", paddingBottom:60 }}>
      {/* Header */}
      <div style={{ background:"var(--bg-card,#fff)", padding:"48px 20px 28px", borderBottom:"1px solid var(--border,#e2e8f0)" }}>
        <button style={{ background:"none", border:"none", color:"#64748b", fontSize:15, fontWeight:600, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", padding:0, marginBottom:16 }}
          onClick={onVoltar}>← Voltar</button>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:48, height:48, background:"#FF6B3518", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>🔒</div>
          <div>
            <div style={{ fontSize:22, fontWeight:900, color:"#0f172a" }}>Política de Privacidade</div>
            <div style={{ fontSize:12, color:"#64748b" }}>Atualizado em maio de 2026 · LGPD</div>
          </div>
        </div>
      </div>

      {/* Resumo rápido */}
      <div style={{ margin:"16px 16px 8px", background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:16, padding:"16px" }}>
        <div style={{ fontWeight:800, fontSize:14, color:"#166534", marginBottom:6 }}>✅ Resumo em 3 pontos</div>
        {["Seus dados nunca são vendidos nem compartilhados com anunciantes.",
          "CPF/CNPJ nunca são exibidos publicamente — ficam só no servidor.",
          "Você pode excluir sua conta e todos os seus dados a qualquer momento."
        ].map((p,i) => (
          <div key={i} style={{ fontSize:13, color:"#15803d", display:"flex", gap:8, marginBottom:4 }}>
            <span>•</span><span>{p}</span>
          </div>
        ))}
      </div>

      {/* Seções acordeão */}
      <div style={{ padding:"0 16px" }}>
        {secoes.map((s, i) => (
          <div key={i} style={{ background:"var(--bg-card,#fff)", borderRadius:14, marginBottom:8, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", cursor:"pointer" }}
              onClick={() => setSecaoAberta(secaoAberta === i ? null : i)}>
              <div style={{ fontWeight:700, fontSize:14, color:"var(--text-1,#0f172a)" }}>{s.titulo}</div>
              <span style={{ color:"#FF6B35", fontSize:18, transition:"transform .2s", transform: secaoAberta === i ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
            </div>
            {secaoAberta === i && (
              <div style={{ padding:"0 16px 16px", fontSize:13, color:"var(--text-2,#475569)", lineHeight:1.8, whiteSpace:"pre-line" as const }}>
                {s.corpo}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Contato DPO */}
      <div style={{ margin:"8px 16px 0", background:"var(--bg-card,#fff)", borderRadius:14, padding:"16px", boxShadow:"0 2px 8px rgba(0,0,0,.06)", textAlign:"center" as const }}>
        <div style={{ fontSize:13, color:"var(--text-2,#64748b)", lineHeight:1.7 }}>
          Dúvidas sobre privacidade? Fale com nosso responsável de dados:<br />
          <strong style={{ color:"#FF6B35" }}>suporte@diariaja.com.br</strong>
        </div>
      </div>

      <div style={{ textAlign:"center", color:"var(--text-3,#94a3b8)", fontSize:11, marginTop:20 }}>
        DiáriaJá · Versão 1.0 · Campo Grande, MS<br />
        Em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018)
      </div>
    </div>
  );
}
