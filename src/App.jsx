import React, { useState, useEffect } from 'react';
import { 
  Key, 
  Settings, 
  Database, 
  Cpu, 
  Terminal, 
  Copy, 
  Check, 
  Lock, 
  Unlock, 
  RefreshCw, 
  Trash2, 
  Power, 
  Eye, 
  EyeOff, 
  Info,
  Maximize2
} from 'lucide-react';

export default function App() {
  // Key state
  const [apiKey, setApiKey] = useState(localStorage.getItem('mm_api_key') || '');
  const [keyStats, setKeyStats] = useState(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  
  // Model lists
  const [activeModels, setActiveModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Admin states
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [adminConfig, setAdminConfig] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);

  // Admin config forms
  const [selectedProvider, setSelectedProvider] = useState('openai');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [contextSizeInput, setContextSizeInput] = useState('8192');
  const [showApiKeys, setShowApiKeys] = useState({});

  // Messages/Alerts
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  // Initial load
  useEffect(() => {
    if (apiKey) {
      fetchKeyStats();
    }
    fetchModels();
  }, [apiKey]);

  // Alert helper
  const triggerAlert = (type, text) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage({ type: '', text: '' }), 5000);
  };

  // Generate a new User Key
  const generateApiKey = async () => {
    setKeyLoading(true);
    try {
      const res = await fetch('/api/keys', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const newKey = data.key.key_value;
        setApiKey(newKey);
        localStorage.setItem('mm_api_key', newKey);
        triggerAlert('success', 'New API Key generated successfully!');
      } else {
        const err = await res.json();
        triggerAlert('error', err.error || 'Failed to generate key.');
      }
    } catch (e) {
      triggerAlert('error', 'Error reaching serverless function.');
    } finally {
      setKeyLoading(false);
    }
  };

  // Fetch Stats for User Key
  const fetchKeyStats = async () => {
    if (!apiKey) return;
    try {
      const res = await fetch(`/api/keys?key=${apiKey}`);
      if (res.ok) {
        const data = await res.json();
        setKeyStats(data);
      } else {
        const err = await res.json();
        if (res.status === 404) {
          // Key deleted or invalid
          localStorage.removeItem('mm_api_key');
          setApiKey('');
          setKeyStats(null);
        }
      }
    } catch (e) {
      console.error("Error fetching stats:", e);
    }
  };

  // Fetch configured Models (public)
  const fetchModels = async () => {
    setModelsLoading(true);
    try {
      const res = await fetch('/v1/models', {
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setActiveModels(data.data || []);
      }
    } catch (e) {
      console.error("Error fetching models:", e);
    } finally {
      setModelsLoading(false);
    }
  };

  // Admin Login
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setAdminError('');
    setAdminLoading(true);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({ action: 'get_config' })
      });

      if (res.ok) {
        const data = await res.json();
        setAdminConfig(data);
        setIsAdminLoggedIn(true);
        setContextSizeInput(data.context_size);
        triggerAlert('success', 'Logged in as Admin successfully.');
      } else {
        const err = await res.json();
        setAdminError(err.error || 'Invalid credentials.');
      }
    } catch (err) {
      setAdminError('Failed to verify credentials.');
    } finally {
      setAdminLoading(false);
    }
  };

  // Fetch admin configs again
  const refreshAdminConfig = async () => {
    if (!isAdminLoggedIn) return;
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({ action: 'get_config' })
      });
      if (res.ok) {
        const data = await res.json();
        setAdminConfig(data);
      }
    } catch (e) {
      console.error("Error refreshing configs:", e);
    }
  };

  // Update Provider Config
  const handleUpdateProvider = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({
          action: 'update_provider',
          provider_id: selectedProvider,
          api_key: providerApiKey || undefined,
          base_url: providerBaseUrl || undefined,
          is_active: true // Auto-activate the configured provider
        })
      });

      if (res.ok) {
        triggerAlert('success', `Activated and configured ${selectedProvider}!`);
        setProviderApiKey('');
        setProviderBaseUrl('');
        await refreshAdminConfig();
        await fetchModels();
      } else {
        const err = await res.json();
        triggerAlert('error', err.error || 'Failed to update provider.');
      }
    } catch (e) {
      triggerAlert('error', 'Network error updating provider.');
    }
  };

  // Update Context Size
  const handleUpdateContextSize = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({
          action: 'update_context_size',
          context_size: contextSizeInput
        })
      });

      if (res.ok) {
        triggerAlert('success', `Context size limit successfully updated to ${contextSizeInput} tokens!`);
        await refreshAdminConfig();
      } else {
        const err = await res.json();
        triggerAlert('error', err.error || 'Failed to update context size.');
      }
    } catch (e) {
      triggerAlert('error', 'Network error updating context size.');
    }
  };

  // Toggle key active/revoked
  const handleToggleKey = async (keyId, currentActive) => {
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({
          action: 'toggle_key',
          key_id: keyId,
          is_active: !currentActive
        })
      });

      if (res.ok) {
        triggerAlert('success', `Key state successfully toggled.`);
        await refreshAdminConfig();
      }
    } catch (e) {
      triggerAlert('error', 'Failed to toggle key status.');
    }
  };

  // Delete key
  const handleDeleteKey = async (keyId) => {
    if (!confirm("Are you sure you want to permanently delete this user key?")) return;
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({
          action: 'delete_key',
          key_id: keyId
        })
      });

      if (res.ok) {
        triggerAlert('success', `Key permanently removed from system.`);
        await refreshAdminConfig();
      }
    } catch (e) {
      triggerAlert('error', 'Failed to delete user key.');
    }
  };

  // Copy helper
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Set provider details on selector change
  useEffect(() => {
    if (adminConfig?.providers) {
      const provider = adminConfig.providers.find(p => p.id === selectedProvider);
      if (provider) {
        setProviderBaseUrl(provider.base_url);
      }
    }
  }, [selectedProvider, adminConfig]);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1.5rem', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Top Status Notification Banner */}
      {statusMessage.text && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          background: statusMessage.type === 'success' ? 'rgba(74, 117, 89, 0.9)' : 'rgba(163, 67, 83, 0.9)',
          color: 'white',
          padding: '0.8rem 1.8rem',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          backdropFilter: 'blur(10px)',
          fontWeight: 500,
          fontSize: '0.95rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          border: '1px solid rgba(255,255,255,0.2)',
          animation: 'fadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
        }}>
          <Info size={18} />
          {statusMessage.text}
        </div>
      )}

      {/* Header Bar */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          {/* Logo SVG instead of emoji */}
          <div style={{
            background: 'linear-gradient(135deg, var(--pink-primary) 0%, var(--pink-dark) 100%)',
            padding: '0.7rem',
            borderRadius: '16px',
            boxShadow: '0 4px 12px rgba(255, 143, 163, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 3.82-2.67 4.7-1.87.88.8 0 3.03-1.5 5 .75 1.18 1.12 2.52 1.1 3.87-.04 2.87-2.24 5.2-5.75 5.58a7 7 0 0 1-5.1-5.58c.02-1.35.39-2.69 1.14-3.87-1.5-1.97-2.38-4.2-1.5-5 .88-.8 2.92-.13 4.7 1.87.65-.17 1.33-.26 2-.26z"/>
              <path d="M9 14h.01M15 14h.01M12 17c.5-1 1.5-1 2 0"/>
            </svg>
          </div>
          <div>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: '1.8rem', letterSpacing: '-0.5px' }}>MaoMaoAI</h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px' }}>Premium AI Access Gateway</p>
          </div>
        </div>

        {/* Lock button on top right */}
        <button 
          onClick={() => {
            setAdminPanelOpen(!adminPanelOpen);
            if (!adminPanelOpen && isAdminLoggedIn) {
              refreshAdminConfig();
            }
          }}
          className="premium-btn-secondary"
          style={{ padding: '0.7rem 1.2rem', borderRadius: '12px' }}
        >
          {isAdminLoggedIn ? <Unlock size={18} style={{ color: 'green' }} /> : <Lock size={18} />}
          <span>{isAdminLoggedIn ? "Admin Dashboard" : "Admin Login"}</span>
        </button>
      </header>

      {/* Admin Panel Panel Overlay / Content */}
      {adminPanelOpen && (
        <section className="glass-panel animate-fade-in" style={{ marginBottom: '2rem', border: '2px solid var(--pink-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255, 143, 163, 0.2)', paddingBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Settings size={22} style={{ color: 'var(--pink-dark)' }} />
              <h2 style={{ fontSize: '1.4rem', fontWeight: 600 }}>Administrative Control Panel</h2>
            </div>
            <button 
              onClick={() => setAdminPanelOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem', fontWeight: 700 }}
            >
              ×
            </button>
          </div>

          {!isAdminLoggedIn ? (
            /* Secure Login Gate */
            <form onSubmit={handleAdminLogin} style={{ maxWidth: '400px', margin: '1rem 0' }}>
              <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Please enter the master credentials password to unlock configurations.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <input 
                    type="password"
                    placeholder="Enter Admin Password..."
                    className="premium-input"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    required
                  />
                  {adminError && <p style={{ color: 'red', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: 500 }}>{adminError}</p>}
                </div>
                <button type="submit" className="premium-btn" disabled={adminLoading} style={{ alignSelf: 'flex-start' }}>
                  {adminLoading ? 'Unlocking...' : 'Unlock Console'}
                </button>
              </div>
            </form>
          ) : (
            /* Logged In Dashboard Dashboard */
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
                
                {/* 1. API Provider Configuration */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
                    <Cpu size={18} />
                    Active Provider Setup
                  </h3>
                  <form onSubmit={handleUpdateProvider} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Select Provider</label>
                      <select 
                        className="premium-input"
                        value={selectedProvider}
                        onChange={(e) => setSelectedProvider(e.target.value)}
                      >
                        <option value="openai">OpenAI (Primary)</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="gemini">Google Gemini (v1beta)</option>
                        <option value="openrouter">OpenRouter (Any Model)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>API Endpoint URL</label>
                      <input 
                        type="text"
                        placeholder="API Base URL..."
                        className="premium-input"
                        value={providerBaseUrl}
                        onChange={(e) => setProviderBaseUrl(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Configure API Key</label>
                      <input 
                        type="password"
                        placeholder="Enter Provider API Key..."
                        className="premium-input"
                        value={providerApiKey}
                        onChange={(e) => setProviderApiKey(e.target.value)}
                      />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Leave blank to keep existing key cached.</span>
                    </div>

                    <button type="submit" className="premium-btn" style={{ marginTop: '0.5rem', alignSelf: 'flex-start' }}>
                      <Power size={16} />
                      Save & Activate
                    </button>
                  </form>
                </div>

                {/* 2. Global Configurations Settings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                  
                  {/* Context Size Input Box */}
                  <div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginBottom: '0.8rem' }}>
                      <Maximize2 size={18} />
                      Context Tokens Limit
                    </h3>
                    <form onSubmit={handleUpdateContextSize} style={{ display: 'flex', gap: '0.5rem' }}>
                      <input 
                        type="number"
                        placeholder="Context size e.g. 8192"
                        className="premium-input"
                        style={{ maxWidth: '180px' }}
                        value={contextSizeInput}
                        onChange={(e) => setContextSizeInput(e.target.value)}
                        min="1"
                        required
                      />
                      <button type="submit" className="premium-btn" style={{ padding: '0 1.2rem' }}>
                        Update
                      </button>
                    </form>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                      Dynamically restricts maximum tokens permitted per user chat completion sequence.
                    </p>
                  </div>

                  {/* Active Providers Overview list */}
                  <div style={{ marginTop: '0.5rem' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-dark)' }}>Active Statuses</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {adminConfig?.providers?.map(p => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.8rem', background: 'rgba(255,255,255,0.25)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)' }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{p.name}</span>
                          <span className={`badge ${p.is_active ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.7rem' }}>
                            {p.is_active ? 'Active Routing' : 'Offline'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </div>

              {/* 3. User Keys Registry Table */}
              <div style={{ marginTop: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
                    <Key size={18} />
                    User Keys Registry ({adminConfig?.keys?.length || 0})
                  </h3>
                  <button onClick={refreshAdminConfig} className="premium-btn-secondary" style={{ padding: '0.4rem 0.8rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                    <RefreshCw size={14} />
                    Reload Table
                  </button>
                </div>

                <div className="premium-table-container">
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th>Alias</th>
                        <th>Gateway API Key</th>
                        <th>Registered Date</th>
                        <th>Total Calls</th>
                        <th>Safety Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminConfig?.keys?.length === 0 ? (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                            No user API keys have been generated yet.
                          </td>
                        </tr>
                      ) : (
                        adminConfig?.keys?.map(k => (
                          <tr key={k.id}>
                            <td style={{ fontWeight: 500 }}>{k.name}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                                  {showApiKeys[k.id] ? k.key_value : `${k.key_value.substring(0, 7)}...${k.key_value.substring(k.key_value.length - 4)}`}
                                </span>
                                <button 
                                  onClick={() => setShowApiKeys(prev => ({ ...prev, [k.id]: !prev[k.id] }))}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                >
                                  {showApiKeys[k.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </div>
                            </td>
                            <td style={{ fontSize: '0.85rem' }}>{new Date(k.created_at).toLocaleDateString()}</td>
                            <td style={{ fontWeight: 600 }}>{k.total_requests}</td>
                            <td>
                              <span className={`badge ${k.is_active ? 'badge-success' : 'badge-danger'}`}>
                                {k.is_active ? 'Approved' : 'Suspended'}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <button 
                                  onClick={() => handleToggleKey(k.id, k.is_active)}
                                  className="premium-btn-secondary"
                                  style={{ padding: '0.3rem 0.6rem', borderRadius: '8px', fontSize: '0.8rem' }}
                                >
                                  {k.is_active ? 'Suspend' : 'Approve'}
                                </button>
                                <button 
                                  onClick={() => handleDeleteKey(k.id)}
                                  className="premium-btn-secondary"
                                  style={{ padding: '0.3rem 0.6rem', borderRadius: '8px', fontSize: '0.8rem', color: '#dc3545', borderColor: 'rgba(220, 53, 69, 0.2)' }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Log out admin session */}
              <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                  onClick={() => {
                    setIsAdminLoggedIn(false);
                    setAdminPassword('');
                    setAdminConfig(null);
                    triggerAlert('success', 'Logged out from admin console.');
                  }}
                  className="premium-btn-secondary"
                  style={{ color: '#dc3545', borderColor: 'rgba(220, 53, 69, 0.2)' }}
                >
                  Terminate Session
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Main UI Body split into generation portal and developer integration guides */}
      <main style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem', flex: 1, alignItems: 'start' }}>
        
        {/* Left Side: Keys Management & Usage Tracker Panel */}
        <section className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.8rem' }}>
          
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Key size={20} style={{ color: 'var(--pink-primary)' }} />
              API Key Provisioning
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Acquire a unique gateway API credentials token to route completions safely.
            </p>
          </div>

          {apiKey ? (
            /* Render active generated key details */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Your Active Access Key
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div className="premium-input" style={{ fontFamily: 'monospace', display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.7)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
                    {apiKey}
                  </div>
                  <button 
                    onClick={() => copyToClipboard(apiKey)}
                    className="premium-btn"
                    style={{ padding: '0 1rem' }}
                  >
                    {isCopied ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                </div>
              </div>

              {/* Rate Limits Stats Tracker */}
              {keyStats && (
                <div style={{ background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.5)', padding: '1.2rem', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Active Endpoint Limit Status</span>
                    <button onClick={fetchKeyStats} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      <RefreshCw size={14} style={{ color: 'var(--pink-dark)' }} />
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    {/* RPM progress */}
                    <div style={{ background: 'rgba(255,255,255,0.3)', padding: '0.8rem', borderRadius: '12px', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem', color: 'var(--text-muted)' }}>REQUESTS / MINUTE</span>
                      <strong style={{ fontSize: '1.4rem', color: 'var(--text-dark)' }}>{keyStats.limits.rpm_used} / {keyStats.limits.rpm_limit}</strong>
                      <div style={{ height: '4px', background: 'rgba(0,0,0,0.05)', borderRadius: '2px', marginTop: '0.5rem', overflow: 'hidden' }}>
                        <div style={{ 
                          width: `${Math.min(100, (keyStats.limits.rpm_used / keyStats.limits.rpm_limit) * 100)}%`, 
                          height: '100%', 
                          background: keyStats.limits.rpm_used >= keyStats.limits.rpm_limit ? 'red' : 'var(--pink-primary)' 
                        }}></div>
                      </div>
                    </div>

                    {/* RPD progress */}
                    <div style={{ background: 'rgba(255,255,255,0.3)', padding: '0.8rem', borderRadius: '12px', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem', color: 'var(--text-muted)' }}>REQUESTS / DAY</span>
                      <strong style={{ fontSize: '1.4rem', color: 'var(--text-dark)' }}>{keyStats.limits.rpd_used} / {keyStats.limits.rpd_limit}</strong>
                      <div style={{ height: '4px', background: 'rgba(0,0,0,0.05)', borderRadius: '2px', marginTop: '0.5rem', overflow: 'hidden' }}>
                        <div style={{ 
                          width: `${Math.min(100, (keyStats.limits.rpd_used / keyStats.limits.rpd_limit) * 100)}%`, 
                          height: '100%', 
                          background: keyStats.limits.rpd_used >= keyStats.limits.rpd_limit ? 'red' : 'var(--pink-primary)' 
                        }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <button 
                onClick={generateApiKey}
                className="premium-btn-secondary"
                disabled={keyLoading}
              >
                {keyLoading ? 'Generating...' : 'Roll Key / Generate New'}
              </button>

            </div>
          ) : (
            /* If no active key generated */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', textAlign: 'center', padding: '1.5rem 0' }}>
              <div style={{
                background: 'rgba(255, 143, 163, 0.1)',
                padding: '1.2rem',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'pulse-ring 2s infinite'
              }}>
                <Key size={30} style={{ color: 'var(--pink-primary)' }} />
              </div>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                You do not have an API token saved in this session. Generate one now to start querying.
              </p>
              <button 
                onClick={generateApiKey}
                className="premium-btn"
                disabled={keyLoading}
                style={{ width: '100%' }}
              >
                {keyLoading ? 'Generating Key...' : 'Generate New API Key'}
              </button>
            </div>
          )}

          {/* Dynamic Active Models List */}
          <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,143,163,0.15)', paddingTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Database size={16} style={{ color: 'var(--pink-primary)' }} />
                Active v1 Models
              </h3>
              <button onClick={fetchModels} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <RefreshCw size={13} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {modelsLoading ? (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Loading live models list...
              </div>
            ) : activeModels.length === 0 ? (
              <div style={{ padding: '0.8rem', background: 'rgba(255,255,255,0.2)', border: '1px dashed rgba(255,143,163,0.3)', borderRadius: '10px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                No models currently registered. Configure an API provider in the admin console to load models.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.6rem', maxHeight: '180px', overflowY: 'auto' }}>
                {activeModels.map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.8rem', background: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.5)', borderRadius: '10px' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600 }}>{m.id}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{m.owned_by}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </section>

        {/* Right Side: Developers & Integration Guides Panel */}
        <section className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.8rem' }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Terminal size={20} style={{ color: 'var(--pink-primary)' }} />
              Integration Guideline
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Point your favourite LLM client frontends directly to your new MaoMaoAI endpoint.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            {/* SillyTavern Integration */}
            <div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '0.4rem' }}>SillyTavern Setup</h4>
              <div style={{ background: 'rgba(0,0,0,0.05)', padding: '0.8rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                <ul style={{ listStyleType: 'none', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <li><strong>API Type:</strong> OpenAI</li>
                  <li><strong>Reverse Proxy Base URL:</strong> <code style={{ wordBreak: 'break-all' }}>{window.location.origin}/v1</code></li>
                  <li><strong>API Key:</strong> <code style={{ wordBreak: 'break-all' }}>{apiKey || 'YOUR_MM_KEY'}</code></li>
                </ul>
              </div>
            </div>

            {/* Python OpenAI SDK */}
            <div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '0.4rem' }}>Python SDK Integration</h4>
              <pre style={{ 
                background: 'rgba(0,0,0,0.06)', 
                padding: '0.8rem', 
                borderRadius: '10px', 
                fontSize: '0.8rem', 
                fontFamily: 'monospace',
                overflowX: 'auto',
                border: '1px solid rgba(255,255,255,0.4)',
                color: '#4a2c3a'
              }}>
{`from openai import OpenAI

client = OpenAI(
    base_url="${window.location.origin}/v1",
    api_key="${apiKey || 'YOUR_MAOMAO_KEY'}"
)

completion = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "user", "content": "Hello MaoMao!"}
    ]
)
print(completion.choices[0].message.content)`}
              </pre>
            </div>

            {/* Safety notice about rate limits and CSAM pre-filtering */}
            <div style={{ background: 'rgba(255, 143, 163, 0.1)', padding: '1rem', borderLeft: '3px solid var(--pink-primary)', borderRadius: '0 8px 8px 0', fontSize: '0.85rem' }}>
              <h5 style={{ fontWeight: 600, marginBottom: '0.2rem', color: 'var(--text-dark)' }}>Safety & Rate Limits</h5>
              <p style={{ color: 'var(--text-muted)' }}>
                Strict safety filtering is automatically enforced. Any Child Sexual Abuse Material (CSAM) flagged attempts will result in instant request termination. Consensual adult NSFW content is permitted. Max rate limits: 3 RPM / 300 RPD.
              </p>
            </div>

          </div>
        </section>

      </main>

      {/* Footer */}
      <footer style={{ marginTop: 'auto', paddingTop: '3rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        <p>© 2026 MaoMaoAI - All Requests Secured & Authenticated by Neon PostgreSQL.</p>
      </footer>

    </div>
  );
}
