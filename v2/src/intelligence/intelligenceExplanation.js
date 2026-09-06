const MODE_LABELS = Object.freeze({
  SEED: 'SEMILLA',
  ADAPTIVE: 'ADAPTATIVO',
  HARD_LIMIT: 'BLOQUEO DURO'
});

const CONFIDENCE_LABELS = Object.freeze({
  INSUFFICIENT: 'SIN HISTORIAL',
  LOW: 'BAJA',
  MEDIUM: 'MEDIA',
  HIGH: 'ALTA'
});

const WARNING_MESSAGES = Object.freeze({
  DEMAND_BELOW_HARD_MIN:
    'La demanda estimada quedó por debajo del mínimo administrativo; se respetó el mínimo duro.',
  DEMAND_ABOVE_HARD_MAX:
    'La demanda estimada supera el máximo administrativo; VIGÍA respetó el límite y deja visible el riesgo.'
});

export function buildVigiaExplanation({
  forecast = {},
  suggestion = {}
} = {}) {
  const mode = String(suggestion.mode || 'SEED').toUpperCase();
  const confidence = String(
    suggestion.confidence || forecast.confidence || 'INSUFFICIENT'
  ).toUpperCase();
  const forecastWeekly = nonNegative(
    suggestion.forecastWeekly ?? forecast.forecastWeekly
  );
  const targetStock = nonNegative(
    suggestion.vigiaTargetStock
  );
  const suggestedQuantity = nonNegative(
    suggestion.suggestedQuantity
  );
  const pendingInbound = nonNegative(
    suggestion.pendingInbound
  );
  const seasonality = forecast.seasonality || {};
  const anomalyProtection = forecast.anomalyProtection || {};
  const reasonCodes = unique([
    ...(forecast.reasonCodes || []),
    ...(suggestion.reasonCodes || [])
  ]);
  const warningCodes = unique(
    suggestion.warningCodes || []
  );

  const reasons = [];
  const warnings = warningCodes.map(
    code => WARNING_MESSAGES[code] || humanizeCode(code)
  );

  if (!suggestion.dynamicReady) {
    reasons.push(
      'Todavía no hay historial suficiente para que la demanda aprendida sustituya la semilla manual.'
    );
  } else {
    reasons.push(
      `Demanda prevista: ${numberText(forecastWeekly)} por semana.`
    );
  }

  const trend = trendText(forecast);
  if (trend) reasons.push(trend);

  const season = seasonalityText(seasonality);
  if (season) reasons.push(season);

  const anomalyCount = Number(
    anomalyProtection.anomalyCount || 0
  );
  if (anomalyCount > 0) {
    reasons.push(
      `Protección anti-anomalías: ${anomalyCount} salida(s) extraordinaria(s) se limitaron solo dentro del modelo; los movimientos reales permanecen intactos.`
    );
  }

  const manualExcludedCount = Number(
    anomalyProtection.manualExcludedCount || 0
  );
  if (manualExcludedCount > 0) {
    reasons.push(
      `${manualExcludedCount} movimiento(s) marcado(s) como extraordinarios fueron excluidos del aprendizaje.`
    );
  }

  if (pendingInbound > 0) {
    reasons.push(
      `Ya vienen ${numberText(pendingInbound)} unidad(es) en camino y se descontaron de la necesidad.`
    );
  }

  if (mode === 'SEED') {
    reasons.push(
      suggestion.dynamicReady
        ? 'Modo SEMILLA: los valores manuales orientan el arranque, pero una demanda confiable puede superarlos o bajar por debajo de ellos.'
        : 'Modo SEMILLA: el mínimo manual actúa como respaldo mientras VIGÍA aprende.'
    );
  } else if (mode === 'ADAPTIVE') {
    reasons.push(
      'Modo ADAPTATIVO: el objetivo se deriva de demanda, cobertura y días de seguridad.'
    );
  } else if (mode === 'HARD_LIMIT') {
    reasons.push(
      'Modo BLOQUEO DURO: mínimo y máximo manuales son límites administrativos obligatorios.'
    );
  }

  const headline = suggestedQuantity > 0
    ? `Reponer ${numberText(suggestedQuantity)}`
    : 'Stock suficiente';

  const summary = suggestion.dynamicReady
    ? `Objetivo VIGÍA ${numberText(targetStock)} · ${confidenceLabel(confidence)} confianza`
    : `Semilla manual activa · ${confidenceLabel(confidence)} confianza`;

  return {
    modelVersion: forecast.modelVersion || 'V4',
    mode,
    modeLabel: modeLabel(mode),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    headline,
    summary,
    forecastWeekly: round(forecastWeekly),
    targetStock: round(targetStock),
    suggestedQuantity: round(suggestedQuantity),
    trendLabel: trendShortLabel(forecast),
    seasonalityLabel: seasonalityShortLabel(seasonality),
    reasons: unique(reasons),
    warnings,
    reasonCodes,
    warningCodes
  };
}

export function modeLabel(mode) {
  const key = String(mode || 'SEED').toUpperCase();
  return MODE_LABELS[key] || key;
}

export function confidenceLabel(confidence) {
  const key = String(
    confidence || 'INSUFFICIENT'
  ).toUpperCase();
  return CONFIDENCE_LABELS[key] || key;
}

function trendText(forecast) {
  if (
    !forecast ||
    forecast.trendConfidence === 'INSUFFICIENT'
  ) {
    return '';
  }

  const direction = forecast.trendDirection || 'STABLE';
  const percent = Number(forecast.trendPercentChange);
  const percentText = Number.isFinite(percent)
    ? ` (${signedNumberText(percent)}%)`
    : '';

  if (direction === 'UP') {
    return `Tendencia reciente al alza${percentText}; VIGÍA aumenta la proyección de forma limitada.`;
  }

  if (direction === 'DOWN') {
    return `Tendencia reciente a la baja${percentText}; VIGÍA reduce la proyección de forma gradual.`;
  }

  return `Tendencia reciente estable${percentText}.`;
}

function trendShortLabel(forecast) {
  if (
    !forecast ||
    forecast.trendConfidence === 'INSUFFICIENT'
  ) {
    return 'Sin tendencia confiable';
  }

  const percent = Number(forecast.trendPercentChange);
  const suffix = Number.isFinite(percent)
    ? ` ${signedNumberText(percent)}%`
    : '';

  if (forecast.trendDirection === 'UP') {
    return `↑ Subiendo${suffix}`;
  }

  if (forecast.trendDirection === 'DOWN') {
    return `↓ Bajando${suffix}`;
  }

  return `→ Estable${suffix}`;
}

function seasonalityText(seasonality) {
  if (!seasonality) return '';

  const confidence = String(
    seasonality.confidence || 'INSUFFICIENT'
  ).toUpperCase();
  const appliedFactor = Number(
    seasonality.appliedFactor ?? 1
  );

  if (confidence === 'INSUFFICIENT') {
    return 'Estacionalidad anual todavía no disponible; falta historial suficiente.';
  }

  if (
    confidence === 'LOW' &&
    Number(appliedFactor) === 1
  ) {
    return 'VIGÍA observa la fase de consumo actual, pero aún no aplica una regla anual.';
  }

  const years = Array.isArray(
    seasonality.comparisonYears
  )
    ? seasonality.comparisonYears.length
    : 0;

  return `Ajuste estacional ${numberText(appliedFactor)}× con confianza ${confidenceLabel(confidence)}${years ? `, usando ${years} período(s) anual(es) comparable(s)` : ''}.`;
}

function seasonalityShortLabel(seasonality) {
  if (!seasonality) return 'Sin estacionalidad';

  const reasonCodes = seasonality.reasonCodes || [];

  if (reasonCodes.includes('ANNUAL_SEASON_HIGH')) {
    return 'Época de demanda alta';
  }

  if (reasonCodes.includes('ANNUAL_SEASON_LOW')) {
    return 'Época de demanda baja';
  }

  if (reasonCodes.includes('ANNUAL_SEASON_STABLE')) {
    return 'Época estable';
  }

  if (
    reasonCodes.some(code =>
      String(code).startsWith('EMERGING_PHASE_')
    )
  ) {
    return 'Fase emergente observada';
  }

  return 'Sin patrón anual aplicado';
}

function humanizeCode(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, letter => letter.toUpperCase());
}

function nonNegative(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number;
}

function numberText(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return String(round(number));
}

function signedNumberText(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  const rounded = round(number);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function round(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 1000
  ) / 1000;
}

function unique(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .filter(Boolean)
  )];
}
