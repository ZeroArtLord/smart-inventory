// Semanas recientes para poder terminar una revisión al cambiar de lunes.
export function recentMonitorWeeks(now = new Date(), count = 9) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() - index * 7);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')].join('-');
  });
}

export function isSelectableMonitorWeek(week, weeks = recentMonitorWeeks()) {
  return weeks.includes(week);
}
