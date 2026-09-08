import React, { useEffect, useRef, useState, useMemo } from 'react';
import Globe from 'react-globe.gl';

// Same deterministic room color as in App.jsx
const ROOM_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#0ea5e9','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
function getRoomColor(roomId) {
  if (!roomId) return null;
  let hash = 0;
  for (const c of roomId) hash = (hash * 31 + c.charCodeAt(0)) % ROOM_COLORS.length;
  return ROOM_COLORS[hash];
}

// 即時脈動漣漪樣式(以 DOM 疊層畫,px 尺寸)。3D 在有貼圖的地球+星空上要夠大夠亮,
// 故比 2D 明顯放大、加厚、加發光衝擊波(blast)與中心白閃(flash)。
const PULSE_RING = {
  listen: { rgb: '56,189,248',  max: 150, rings: 2, dur: 2000 }, // 聆聽 — 青色衝擊波
  play:   { rgb: '245,158,11',  max: 220, rings: 2, dur: 2100 }, // 開始挑戰 — 琥珀衝擊波
  done:   { rgb: '253,224,71',  max: 300, rings: 3, dur: 2400 }, // 完成 — 金色大衝擊波
  fruit:  { rgb: '252,211,77',  max: 360, rings: 4, dur: 2600 }, // 創新高得新果子 — 最盛大的金色衝擊波
};
let activeRing3DCount = 0;
const lastRing3DAt = {};
function build3DPulseHtml(action) {
  const cfg = PULSE_RING[action] || PULSE_RING.listen;
  const { rgb, dur, max } = cfg;
  let html = `<span class="vr3d-blast" style="--vr-rgb:${rgb}; --vr-dur:${dur}ms; width:${max}px; height:${max}px;"></span>`;
  for (let i = 0; i < cfg.rings; i++) {
    html += `<span class="vr3d-ring" style="--vr-rgb:${rgb}; --vr-max:${max}px; --vr-dur:${dur}ms; animation-delay:${i * 180}ms;"></span>`;
  }
  html += `<span class="vr3d-flash" style="--vr-rgb:${rgb};"></span>`;
  return { html, life: dur + (cfg.rings - 1) * 180 + 200 };
}

export default function WorldMap3D({ t, playerName, onJoinRoom, onToggleMode, currentMode, focusLocation, playTone, playWelcome, onEnableAudio }) {
  const globeEl = useRef(null);
  const containerRef = useRef(null);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 520 });
  const [altitude, setAltitude] = useState(2.5);
  const pulseOverlayRef = useRef(null); // 即時脈動漣漪的 DOM 疊層
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem('verseRain_mapSound') === '1'; } catch { return false; }
  });
  const playersRef = useRef(players);
  const soundOnRef = useRef(soundOn);
  const playToneRef = useRef(playTone);
  const playWelcomeRef = useRef(playWelcome);
  const prevPlayerNamesRef = useRef(null);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  useEffect(() => { playToneRef.current = playTone; }, [playTone]);
  useEffect(() => { playWelcomeRef.current = playWelcome; }, [playWelcome]);
  // 有新朋友加入 → 歡迎小號(需 🔊 開啟);首次載入不觸發。
  useEffect(() => {
    const names = new Set(players.map(p => p && p.name).filter(Boolean));
    const prev = prevPlayerNamesRef.current;
    // 首次「真的有玩家」才建立基準(避免把首批載入當成新加入)。
    if (prev === null) {
      if (names.size > 0) prevPlayerNamesRef.current = names;
      return;
    }
    prevPlayerNamesRef.current = names;
    let hasNew = false;
    for (const n of names) { if (!prev.has(n)) { hasNew = true; break; } }
    if (hasNew && soundOnRef.current) { try { playWelcomeRef.current?.(); } catch {} }
  }, [players]);

  // Handle container resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: 520
        });
      }
    };
    window.addEventListener('resize', updateSize);
    updateSize(); // initial set
    
    // Sometimes it takes a moment for layout to settle
    setTimeout(updateSize, 100);
    setTimeout(updateSize, 500);
    
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Fetch player map data + auto-refresh every 30s
  useEffect(() => {
    const load = () => {
      fetch('/api/get-player-map')
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setPlayers(data); else setPlayers([]); setLoading(false); })
        .catch(() => { setError('Failed to load map data'); setLoading(false); });
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  // Add initial setting and set controls after mount
  const initialFlyDone = useRef(false);
  useEffect(() => {
    if (globeEl.current && !loading) {
      globeEl.current.controls().autoRotate = false; // Stopped auto rotation per user request
      
      // Auto move view to current player on first load
      if (!initialFlyDone.current && players.length > 0) {
        const myPlayer = players.find(p => p.name === playerName);
        if (myPlayer) {
          setTimeout(() => {
            if (globeEl.current) {
              globeEl.current.pointOfView({ lat: myPlayer.lat, lng: myPlayer.lng, altitude: 1.5 }, 2000);
            }
          }, 500);
        }
        initialFlyDone.current = true;
      }
    }
  }, [loading, players, playerName]);

  // 即時脈動:訂閱 window 事件,在對應玩家座標盪出環(react-globe.gl ringsData)。
  // 只掛一次,靠 ref 讀當前 players / 音效狀態。
  useEffect(() => {
    const onPulse = (e) => {
      const { name, action } = (e && e.detail) || {};
      const now = Date.now();
      const key = name + ':' + action;
      if (now - (lastRing3DAt[key] || 0) < 600) return; // 去重
      lastRing3DAt[key] = now;
      if (activeRing3DCount > 40 && action !== 'done' && action !== 'fruit') return; // 塞車保護
      const p = (playersRef.current || []).find(x => x.name === name);
      if (!p || p.lat == null || p.lng == null) return;

      const globe = globeEl.current;
      const overlay = pulseOverlayRef.current;
      if (!globe || !overlay || !globe.getScreenCoords) return;

      const { html, life } = build3DPulseHtml(action);
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:absolute;left:0;top:0;will-change:transform;';
      wrap.innerHTML = html;
      overlay.appendChild(wrap);
      activeRing3DCount++;

      // 把漣漪定位到玩家座標的螢幕像素,並在點位於地球背面時隱藏。
      // 用 setInterval(非 rAF)以便背景分頁 / 隱藏時仍能定位;autoRotate 已關,
      // 位置在漣漪生命期內大致固定,拖曳時每 60ms 跟一次。
      const camera = globe.camera && globe.camera();
      const place = () => {
        if (!wrap.isConnected) return;
        try {
          const sc = globe.getScreenCoords(p.lat, p.lng, 0.01);
          let facing = true;
          if (camera && globe.getCoords) {
            const c = globe.getCoords(p.lat, p.lng, 0);
            facing = (c.x * camera.position.x + c.y * camera.position.y + c.z * camera.position.z) > 0;
          }
          wrap.style.transform = `translate(${sc.x}px, ${sc.y}px)`;
          wrap.style.display = facing ? 'block' : 'none';
        } catch {}
      };
      place(); // 立即定位(同步)
      const iv = setInterval(place, 60);
      setTimeout(() => {
        clearInterval(iv);
        try { overlay.removeChild(wrap); } catch {}
        activeRing3DCount = Math.max(0, activeRing3DCount - 1);
      }, life);

      if (soundOnRef.current) { try { playToneRef.current?.(action); } catch {} }
    };
    window.addEventListener('verserain:pulse', onPulse);
    return () => window.removeEventListener('verserain:pulse', onPulse);
  }, []);

  // 3D→2D→3D 焦點呼應:切回 3D 時飛到帶入的座標。
  useEffect(() => {
    if (!loading && focusLocation && globeEl.current && typeof focusLocation.lat === 'number') {
      globeEl.current.pointOfView({ lat: focusLocation.lat, lng: focusLocation.lng, altitude: 1.2 }, 1000);
    }
  }, [focusLocation, loading]);

  const mapData = useMemo(() => {
    // Dynamic grid size based on altitude to break apart clusters when zooming in
    // At default altitude (2.5), grid size is ~7.5 degrees
    // Below 0.2 (zoomed in completely), clustering stops
    const gridSize = altitude > 0.3 ? altitude * 3 : 0; 
    
    // 1. Group into clusters
    const clusters = [];
    players.forEach(p => {
      if (gridSize === 0) {
        clusters.push({ lat: p.lat, lng: p.lng, players: [p] });
        return;
      }
      
      const gridLat = Math.round(p.lat / gridSize) * gridSize;
      const gridLng = Math.round(p.lng / gridSize) * gridSize;
      
      const existing = clusters.find(c => c.gridLat === gridLat && c.gridLng === gridLng);
      if (existing) {
        existing.players.push(p);
      } else {
        clusters.push({ lat: p.lat, lng: p.lng, gridLat, gridLng, players: [p] });
      }
    });

    // 2. Format output
    return clusters.map(cluster => {
      // If it's a single player, render standard marker
      if (cluster.players.length === 1) {
        const p = cluster.players[0];
        const isCurrentUser = p.name === playerName;
        const roomColor = getRoomColor(p.roomId);
        
        let bgColor = roomColor || (isCurrentUser ? '#fde047' : '#fb923c');
        let borderColor = 'rgba(255,255,255,0.9)';
        let glowStyle = roomColor
          ? `box-shadow: 0 0 0 2px ${roomColor}55, 0 0 12px ${roomColor}cc;`
          : (isCurrentUser
              ? 'box-shadow: 0 0 0 3px rgba(8,47,63,0.9), 0 0 16px #fde047;'
              : 'box-shadow: 0 0 0 2px rgba(2,8,23,0.7), 0 0 12px rgba(251,146,60,0.95);');
        let opacity = 1.0;
        let filter = 'none';

        if (selectedRoom) {
          if (p.roomId !== selectedRoom) {
             opacity = 0.3;
             filter = 'grayscale(100%)';
             glowStyle = 'none';
             bgColor = '#475569';
             borderColor = '#334155';
          }
        }

        return {
          isCluster: false,
          lat: p.lat,
          lng: p.lng,
          name: p.name,
          roomId: p.roomId,
          bgColor,
          borderColor,
          opacity,
          filter,
          glowStyle,
          isCurrentUser,
          roomColor,
          locationStr: `📍 ${p.city ? p.city + ', ' : ''}${p.country || 'Unknown'}`,
          lastOnline: p.updatedAt ? new Date(p.updatedAt).toLocaleString() : 'Unknown',
        };
      }
      
      // If it's a cluster, render numbered cluster marker
      const avgLat = cluster.players.reduce((sum, p) => sum + p.lat, 0) / cluster.players.length;
      const avgLng = cluster.players.reduce((sum, p) => sum + p.lng, 0) / cluster.players.length;
      const isCurrentUserInCluster = cluster.players.some(p => p.name === playerName);
      
      let opacity = 1.0;
      let filter = 'none';
      let bgColor = '#1e293b';
      let borderColor = '#334155';
      let glowStyle = 'box-shadow: 0 4px 10px rgba(0,0,0,0.4);';

      if (selectedRoom) {
        const hasSelected = cluster.players.some(p => p.roomId === selectedRoom);
        if (hasSelected) {
          bgColor = getRoomColor(selectedRoom);
          borderColor = bgColor;
          glowStyle = `box-shadow: 0 0 0 3px ${bgColor}55, 0 0 12px ${bgColor}88;`;
        } else {
          opacity = 0.3;
          filter = 'grayscale(100%)';
          glowStyle = 'none';
        }
      } else if (isCurrentUserInCluster) {
         borderColor = '#fbbf24';
      }

      return {
        isCluster: true,
        lat: avgLat,
        lng: avgLng,
        count: cluster.players.length,
        players: cluster.players,
        bgColor,
        borderColor,
        opacity,
        filter,
        glowStyle
      };
    });
  }, [players, playerName, selectedRoom, altitude]);

  const htmlElement = (d) => {
    const el = document.createElement('div');
    
    if (d.isCluster) {
      el.innerHTML = `<div style="
          background-color: ${d.bgColor};
          color: white;
          border-radius: 50%;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-family: system-ui, sans-serif;
          font-size: 14px;
          border: 2px solid ${d.borderColor};
          opacity: ${d.opacity};
          filter: ${d.filter};
          ${d.glowStyle}
          transition: transform 0.2s;
          cursor: pointer;
          pointer-events: auto;
        " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">${d.count}</div>`;
        
      const tooltipNames = d.players.slice(0, 10).map(p => p.name).join(', ') + (d.players.length > 10 ? '...' : '');
      el.title = `${d.count} ${t('名玩家', 'players')}\n${tooltipNames}`;
        
      el.onclick = () => {
        if (globeEl.current && onToggleMode) {
           globeEl.current.controls().autoRotate = false;
           // Instantly switch to 2D Map on any click
           onToggleMode({ lat: d.lat, lng: d.lng });
        }
      };
    } else {
      // 只畫一個小光點(不顯示名字,避免擁擠);名字改放 hover title。
      const size = d.isCurrentUser ? 15 : 11;
      el.innerHTML = `<div style="
          width:${size}px; height:${size}px;
          background:${d.bgColor};
          border-radius:50%;
          border:1px solid ${d.borderColor};
          opacity: ${d.opacity};
          filter: ${d.filter};
          ${d.glowStyle}
          cursor:pointer;
          pointer-events: auto;
          transition: transform 0.2s;
        " onmouseover="this.style.transform='scale(1.4)'" onmouseout="this.style.transform='scale(1)'"></div>`;
        
      el.title = `${d.name}\n${d.locationStr}\n${d.roomId ? '⚔️ ' + t('房間', 'Room') + ' ' + d.roomId + '\n' : ''}🕒 ${t('最後上線', 'Last Online')}: ${d.lastOnline}`;
        
      el.onclick = () => {
        if (globeEl.current && onToggleMode) {
           globeEl.current.controls().autoRotate = false;
           // Instantly switch to 2D Map on any click
           onToggleMode({ lat: d.lat, lng: d.lng });
        }
      };
    }
    
    return el;
  };

  return (
    <div>
      <style>{`
        .vr3d-blast {
          position: absolute; left: 0; top: 0; border-radius: 50%;
          transform: translate(-50%, -50%) scale(0);
          background: radial-gradient(circle, rgba(var(--vr-rgb),0.5) 0%, rgba(var(--vr-rgb),0.16) 42%, transparent 70%);
          animation: vr3d-blast var(--vr-dur) cubic-bezier(.2,.7,.3,1) forwards;
          pointer-events: none;
        }
        .vr3d-ring {
          position: absolute; left: 0; top: 0; border-radius: 50%;
          border: 4px solid rgba(var(--vr-rgb),0.95);
          box-shadow: 0 0 30px rgba(var(--vr-rgb),0.9), inset 0 0 16px rgba(var(--vr-rgb),0.8);
          transform: translate(-50%, -50%);
          animation: vr3d-ripple var(--vr-dur) cubic-bezier(.2,.7,.3,1) forwards;
          pointer-events: none; will-change: width, height, opacity;
        }
        .vr3d-flash {
          position: absolute; left: 0; top: 0; width: 22px; height: 22px; border-radius: 50%;
          background: #fff;
          box-shadow: 0 0 26px rgba(var(--vr-rgb),1), 0 0 42px rgba(255,255,255,0.7);
          transform: translate(-50%, -50%) scale(0.4);
          animation: vr3d-flash 720ms ease-out forwards; pointer-events: none;
        }
        @keyframes vr3d-ripple {
          from { width: 6px; height: 6px; opacity: 0.95; }
          15% { opacity: 0.9; }
          to { width: var(--vr-max); height: var(--vr-max); opacity: 0; }
        }
        @keyframes vr3d-blast {
          from { transform: translate(-50%,-50%) scale(0); opacity: 0.9; }
          to { transform: translate(-50%,-50%) scale(1); opacity: 0; }
        }
        @keyframes vr3d-flash {
          0% { transform: translate(-50%,-50%) scale(0.4); opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(2.6); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vr3d-ring, .vr3d-blast, .vr3d-flash { animation-duration: 720ms !important; }
        }
      `}</style>
      {/* Stats bar */}
      <div style={{ padding: '0.8rem 2rem', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ color: '#475569', fontSize: '0.9rem' }}>
          🌍 <strong style={{ color: '#0ea5e9' }}>{players.length}</strong> {t('位玩家遍佈全球', 'players worldwide')}
        </div>
        {(() => {
          const activeRooms = [...new Set(players.filter(p => p.roomId).map(p => p.roomId))];
          return activeRooms.length > 0 ? (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: '#475569', fontSize: '0.9rem' }}>⚔️ <strong style={{ color: '#ef4444' }}>{activeRooms.length}</strong> {t('場比賽進行中', 'active rooms')}:</span>
              {activeRooms.map(rid => (
                <button 
                  key={rid} 
                  title={t('點擊縮放，雙擊加入房間', 'Click to zoom, double click to join')}
                  onClick={() => {
                    const isSelecting = selectedRoom !== rid;
                    setSelectedRoom(isSelecting ? rid : null);
                    if (isSelecting) {
                      const roomPlayers = players.filter(p => p.roomId === rid);
                      if (roomPlayers.length > 0 && globeEl.current) {
                        const lats = roomPlayers.map(p => p.lat);
                        const lngs = roomPlayers.map(p => p.lng);
                        const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
                        const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
                        globeEl.current.controls().autoRotate = false;
                        globeEl.current.pointOfView({ lat: midLat, lng: midLng, altitude: 0.8 }, 1500);
                      }
                    } else if (globeEl.current) {
                        globeEl.current.controls().autoRotate = false;
                    }
                  }}
                  onDoubleClick={() => {
                    if (onJoinRoom) onJoinRoom(rid);
                  }}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  style={{ 
                    display: 'inline-flex', alignItems: 'center', gap: '4px', background: selectedRoom === rid ? getRoomColor(rid) + '88' : getRoomColor(rid) + '22', 
                    color: selectedRoom === rid ? '#fff' : getRoomColor(rid), border: `1px solid ${getRoomColor(rid)}`, borderRadius: '99px', 
                    padding: '2px 10px', fontSize: '0.78rem', fontWeight: 'bold', cursor: 'pointer',
                    transition: 'transform 0.2s', outline: 'none'
                  }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: getRoomColor(rid), display: 'inline-block' }}></span>
                  {rid} {t('({n} 人)', '({n} people)').replace('{n}', String(players.filter(p => p.roomId === rid).length))}
                </button>
              ))}
            </div>
          ) : null;
        })()}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
          <button
            title={soundOn ? t('關閉聲音', 'Mute') : t('開啟交響音效', 'Play the symphony')}
            onClick={() => {
              setSoundOn(v => {
                const n = !v;
                try { localStorage.setItem('verseRain_mapSound', n ? '1' : '0'); } catch {}
                if (n) { onEnableAudio?.(); playTone?.('play'); }
                return n;
              });
            }}
            style={{ background: soundOn ? '#0ea5e9' : '#e2e8f0', color: soundOn ? '#fff' : '#475569', border: 'none', padding: '0.3rem 0.7rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}
          >
            {soundOn ? '🔊' : '🔈'} {t('聲音', 'Sound')}
          </button>
          <button
            title={t('切換 2D / 3D 地球', 'Toggle 2D / 3D globe')}
            onClick={() => onToggleMode?.()}
            style={{ background: '#1e293b', color: '#fff', border: 'none', padding: '0.3rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}
          >
            🗺️ {t('2D 地圖', '2D Map')}
          </button>
          <button
            onClick={() => {
              setLoading(true);
              fetch('/api/get-player-map').then(r => r.json()).then(data => {
                setPlayers(Array.isArray(data) ? data : []);
                setLoading(false);
              }).catch(() => setLoading(false));
            }}
            style={{ background: '#0ea5e9', color: 'white', border: 'none', padding: '0.3rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}
          >
            🔄 {t('重新整理', 'Refresh')}
          </button>
        </div>
      </div>

      {/* Map container */}
      <div dir="ltr" ref={containerRef} style={{ width: '100%', height: '520px', background: '#e0f2fe', cursor: 'grab' }} onMouseDown={(e) => e.currentTarget.style.cursor='grabbing'} onMouseUp={(e) => e.currentTarget.style.cursor='grab'}>
        {loading ? (
          <div style={{ height: '520px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '1.1rem' }}>
            ⏳ {t('載入地球中...', 'Loading globe...')}
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            {error && (
              <div style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: '#ef4444', color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                ⚠️ {error}
              </div>
            )}
            <Globe
              ref={globeEl}
              width={dimensions.width}
              height={dimensions.height}
              globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
              bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
              backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
              htmlElementsData={mapData}
              htmlElement={htmlElement}
              onZoom={({ altitude: newAltitude }) => setAltitude(newAltitude)}
              htmlAltitude={0.05}
              htmlTransitionDuration={100}
            />
            {/* 即時脈動漣漪疊層(投影 lat/lng → 螢幕像素) */}
            <div ref={pulseOverlayRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 5 }} />
            {players.length === 0 && !error && (
              <div style={{ position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.5)', pointerEvents: 'none', fontSize: '1rem', background: 'rgba(0,0,0,0.5)', padding: '0.5rem 1rem', borderRadius: '20px' }}>
                {t('還沒有玩家資料，完成一局遊戲後你的位置就會出現！', 'No players yet — complete a game to appear on the map!')}
              </div>
            )}
            
            {/* Compass / Reset view hint */}
            <div 
              style={{ position: 'absolute', bottom: '20px', left: '20px', background: 'rgba(255,255,255,0.8)', padding: '5px 10px', borderRadius: '8px', fontSize: '0.8rem', color: '#475569', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', cursor: 'pointer', fontWeight: 'bold' }}
              onClick={() => {
                const myPlayer = players.find(p => p.name === playerName);
                if (globeEl.current) {
                    globeEl.current.pointOfView({ 
                      lat: myPlayer ? myPlayer.lat : 20, 
                      lng: myPlayer ? myPlayer.lng : 105, 
                      altitude: 2.5 
                    }, 1000);
                }
                setSelectedRoom(null);
              }}
            >
              🔄 {t('還原視角', 'Reset View')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
