// Tela informativa "Formalize-se como MEI". Texto/links estáticos.
// Extraída do App.tsx e carregada sob demanda (React.lazy). O destino do
// "Voltar" depende do tipo de usuário — calculado no pai e injetado por prop.
export default function MeiInfo({ onVoltar }: { onVoltar: () => void }) {
  const beneficios = [
    { ic:"🪪", t:"CNPJ próprio", d:"No DiáriaJá você vira Pessoa Jurídica e ganha mais confiança e contatos." },
    { ic:"🧾", t:"Emite nota fiscal", d:"Atenda empresas e clientes que exigem nota." },
    { ic:"👵", t:"Aposentadoria e benefícios", d:"Acesso ao INSS: aposentadoria, auxílio-doença e salário-maternidade." },
    { ic:"🏦", t:"Conta e crédito PJ", d:"Conta empresarial, empréstimos e compras no atacado." },
  ];
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg-app,#f0f2f5)", fontFamily:"Inter, system-ui, sans-serif", maxWidth:480, margin:"0 auto", paddingBottom:60 }}>
      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#0f766e,#16a34a)", padding:"48px 20px 28px" }}>
        <button style={{ background:"none", border:"none", color:"rgba(255,255,255,.9)", fontSize:15, cursor:"pointer", fontFamily:"Inter, system-ui, sans-serif", padding:0, marginBottom:16 }}
          onClick={onVoltar}>← Voltar</button>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:48, height:48, background:"rgba(255,255,255,.2)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>💼</div>
          <div>
            <div style={{ fontSize:22, fontWeight:900, color:"#fff" }}>Formalize-se como MEI</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,.85)" }}>Tenha seu CNPJ e mais oportunidades</div>
          </div>
        </div>
      </div>

      {/* A DiáriaJá apoia */}
      <div style={{ margin:"16px 16px 8px", background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:16, padding:"14px 16px" }}>
        <div style={{ fontSize:14, fontWeight:800, color:"#166534", marginBottom:4 }}>💚 A DiáriaJá apoia a formalização</div>
        <div style={{ fontSize:13, color:"#15803d", lineHeight:1.5 }}>
          A gente acredita que quem trabalha por conta própria merece mais segurança. Trabalhador com CNPJ tem benefícios, proteção e acesso a novas oportunidades.
        </div>
      </div>

      {/* O que é */}
      <div style={{ margin:"8px 16px", background:"var(--bg-card,#fff)", borderRadius:14, padding:"14px 16px", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
        <div style={{ fontSize:13, fontWeight:800, color:"var(--text-1,#0f172a)", marginBottom:6 }}>O que é o MEI?</div>
        <div style={{ fontSize:13, color:"var(--text-2,#475569)", lineHeight:1.6 }}>
          O MEI (Microempreendedor Individual) é o jeito mais simples de ter um CNPJ no Brasil — feito pra quem trabalha por conta própria, como prestadores de serviço.
        </div>
      </div>

      {/* Benefícios */}
      <div style={{ margin:"8px 16px" }}>
        {beneficios.map(b => (
          <div key={b.t} style={{ display:"flex", gap:12, alignItems:"flex-start", background:"var(--bg-card,#fff)", borderRadius:14, padding:"12px 14px", marginBottom:8, boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
            <span style={{ fontSize:22, flexShrink:0 }}>{b.ic}</span>
            <div>
              <div style={{ fontSize:13, fontWeight:800, color:"var(--text-1,#0f172a)" }}>{b.t}</div>
              <div style={{ fontSize:12, color:"var(--text-2,#64748b)", lineHeight:1.5, marginTop:2 }}>{b.d}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quem pode */}
      <div style={{ margin:"8px 16px", background:"#fff7ed", border:"1.5px solid #fed7aa", borderRadius:14, padding:"14px 16px" }}>
        <div style={{ fontSize:13, fontWeight:800, color:"#9a3412", marginBottom:6 }}>Quem pode ser MEI?</div>
        <div style={{ fontSize:12, color:"#7c3b15", lineHeight:1.6 }}>
          Fatura até cerca de <strong>R$ 81 mil por ano</strong>, não é sócio/dono de outra empresa e exerce uma atividade permitida. Há uma taxa mensal (DAS) de aproximadamente <strong>R$ 75</strong>, que cobre seus benefícios.
        </div>
      </div>

      {/* Botões oficiais */}
      <div style={{ margin:"16px 16px 8px", display:"flex", flexDirection:"column" as const, gap:10 }}>
        <a href="https://www.gov.br/empresas-e-negocios/pt-br/empreendedor" target="_blank" rel="noopener noreferrer"
          style={{ display:"block", textAlign:"center" as const, background:"#16a34a", color:"#fff", borderRadius:14, padding:"14px", fontSize:15, fontWeight:800, textDecoration:"none", boxShadow:"0 4px 14px rgba(22,163,74,.35)" }}>
          🟢 Abrir meu MEI no site oficial (gov.br)
        </a>
        <a href="https://sebrae.com.br/sites/PortalSebrae/sebraeaz/o-que-e-ser-mei,e0ba13ec29873410VgnVCM1000003b74010aRCRD" target="_blank" rel="noopener noreferrer"
          style={{ display:"block", textAlign:"center" as const, background:"var(--bg-card,#fff)", color:"#0f766e", border:"1.5px solid #0f766e", borderRadius:14, padding:"13px", fontSize:14, fontWeight:800, textDecoration:"none" }}>
          🔵 Ajuda gratuita do SEBRAE
        </a>
      </div>

      {/* Aviso legal */}
      <div style={{ margin:"8px 16px 0", padding:"12px 14px", background:"var(--bg-surface,#f8fafc)", border:"1px solid var(--border,#e2e8f0)", borderRadius:12 }}>
        <div style={{ fontSize:11, color:"var(--text-2,#64748b)", lineHeight:1.6 }}>
          ⚠️ A DiáriaJá é uma plataforma independente e <strong>não realiza</strong> o cadastro nem tem vínculo com o governo. A abertura do MEI é <strong>gratuita</strong> e feita somente no site oficial (gov.br). Desconfie de sites que cobram para abrir o MEI.
        </div>
      </div>
    </div>
  );
}
