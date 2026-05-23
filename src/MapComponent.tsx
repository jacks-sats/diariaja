import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

// Corrige o ícone padrão do Leaflet quando usado com Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface Diarista {
  id: number;
  nome: string;
  funcao: string;
  foto: string;
  disponivel: boolean;
  lat: number;
  lng: number;
  cor: string;
  valor: number;
}

interface MarkerGenerico {
  lat: number;
  lng: number;
  label: string;
  sub?: string;
  cor?: string;
}

interface Props {
  diaristas?: Diarista[];
  corNegocio?: string;
  onDiaristaClick?: (id: number) => void;
  center?: [number, number];
  // Modo genérico de marcadores (para vagas do diarista)
  lat?: number;
  lng?: number;
  markers?: MarkerGenerico[];
}

const CAMPO_GRANDE: [number, number] = [-20.45, -54.65];

export default function MapComponent({ diaristas, corNegocio, onDiaristaClick, center, lat, lng, markers }: Props) {
  // Modo genérico: lat/lng + markers
  const centerResolved: [number, number] = center ?? (lat && lng ? [lat, lng] : CAMPO_GRANDE);
  return (
    <MapContainer
      center={centerResolved}
      zoom={14}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {/* Marcador do usuário */}
      {centerResolved && (corNegocio || lat) && (
        <Marker position={centerResolved} icon={L.divIcon({
          className: "",
          html: `<div style="width:20px;height:20px;border-radius:50%;background:${corNegocio||"#FF6B35"};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        })}>
          <Popup><div style={{ textAlign:"center", fontFamily:"system-ui,sans-serif", padding:"4px 0" }}><strong style={{ fontSize:13 }}>📍 Você está aqui</strong></div></Popup>
        </Marker>
      )}
      {/* Marcadores genéricos (vagas) */}
      {(markers || []).map((m, i) => (
        <Marker key={i} position={[m.lat, m.lng]} icon={L.divIcon({
          className: "",
          html: `<div style="background:${m.cor||"#FF6B35"};color:#fff;border-radius:20px;padding:4px 10px;font-size:11px;font-weight:700;font-family:system-ui;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3)">${m.label}</div>`,
          iconSize: [100, 28],
          iconAnchor: [50, 14],
        })}>
          <Popup><div style={{ textAlign:"center", fontFamily:"system-ui,sans-serif" }}><strong>{m.label}</strong>{m.sub && <><br/><span style={{ color:"#16a34a", fontWeight:700 }}>{m.sub}</span></>}</div></Popup>
        </Marker>
      ))}
      {/* Marcadores de diaristas */}
      {(diaristas || []).map(d => (
        <Marker key={d.id} position={[d.lat, d.lng]}>
          <Popup>
            <div style={{ textAlign: "center", padding: "4px 0", fontFamily: "system-ui, sans-serif" }}>
              <div style={{
                width: 36, height: 36, borderRadius: 18,
                background: d.cor, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 900, fontSize: 12, margin: "0 auto 6px"
              }}>
                {d.foto}
              </div>
              <strong style={{ fontSize: 14 }}>{d.nome}</strong><br />
              <span style={{ color: "#64748b", fontSize: 12 }}>{d.funcao}</span><br />
              <strong style={{ fontSize: 13 }}>R$ {d.valor}/dia</strong><br />
              <span style={{
                display: "inline-block", marginTop: 4, marginBottom: 6,
                padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: d.disponivel ? "#dcfce7" : "#f1f5f9",
                color: d.disponivel ? "#16a34a" : "#94a3b8"
              }}>
                {d.disponivel ? "● disponível" : "● ocupado"}
              </span><br />
              <button
                onClick={() => onDiaristaClick && onDiaristaClick(d.id)}
                style={{
                  padding: "6px 14px", background: corNegocio || "#FF6B35", color: "#fff",
                  border: "none", borderRadius: 8, cursor: "pointer",
                  fontSize: 12, fontWeight: 700, fontFamily: "system-ui, sans-serif"
                }}
              >
                Ver perfil
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
