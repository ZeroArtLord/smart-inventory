// Despliegue seguro en VIGÍA real: piloto opt-in por URL y apagado por servidor.
// No modifica configuraciones, colas ni inventarios del navegador.
export async function isMonitorPilotEnabled({
  search = typeof location === 'undefined' ? '' : location.search,
  fetcher = fetch
} = {}) {
  if (new URLSearchParams(search).get('vigiaMonitorPilot') !== '1') return false;
  try {
    const response=await fetcher('/api/v1/public/config',{cache:'no-store'});
    if (!response.ok) return false;
    const value=await response.json();
    return value?.monitorPilotEnabled===true;
  } catch {
    // Si no podemos confirmar el interruptor del servidor, el piloto no se abre.
    return false;
  }
}
