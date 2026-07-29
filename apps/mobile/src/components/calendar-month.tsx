import {
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react-native';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { dateStr, parseDate, todayStr } from '../lib/date';
import { radius, type as t, useTheme } from '../lib/theme';
import type { CalendarEntry } from '../lib/types';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

export function shiftMonth(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
}

export function calendarDays(month: Date): Date[] {
  const first = startOfMonth(month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function calendarRange(month: Date) {
  const days = calendarDays(month);
  return {
    start: dateStr(days[0]),
    end: dateStr(days[days.length - 1]),
  };
}

export function CalendarMonth({
  entries = [],
  minimumDate,
  onClose,
  onMonthChange,
  onSelect,
  selectedDate,
  visibleMonth,
}: {
  entries?: CalendarEntry[];
  minimumDate?: string;
  onClose?: () => void;
  onMonthChange: (month: Date) => void;
  onSelect: (date: string) => void;
  selectedDate: string;
  visibleMonth: Date;
}) {
  const c = useTheme();
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const minimumMonth = minimumDate
    ? startOfMonth(parseDate(minimumDate))
    : null;
  const canGoPrevious =
    !minimumMonth || visibleMonth.getTime() > minimumMonth.getTime();
  const markers = useMemo(() => {
    const result = new Map<
      string,
      { eventCount: number; menuCount: number; taskCount: number }
    >();
    for (const entry of entries) {
      const current = result.get(entry.date) ?? {
        eventCount: 0,
        menuCount: 0,
        taskCount: 0,
      };
      if (entry.module === 'menu') {
        current.menuCount += entry.metadata.itemCount ?? 0;
      } else if (entry.module === 'task') {
        current.taskCount += 1;
      } else {
        current.eventCount += 1;
      }
      result.set(entry.date, current);
    }
    return result;
  }, [entries]);

  return (
    <View>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="上个月"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canGoPrevious }}
          disabled={!canGoPrevious}
          onPress={() => onMonthChange(shiftMonth(visibleMonth, -1))}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: pressed ? c.fill : 'transparent' },
          ]}
        >
          <ChevronLeft
            color={canGoPrevious ? c.label : c.tertiaryLabel}
            size={20}
          />
        </Pressable>

        <Text style={[t.headline, { color: c.label }]}>
          {visibleMonth.getFullYear()}年 {visibleMonth.getMonth() + 1}月
        </Text>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="下个月"
            accessibilityRole="button"
            onPress={() => onMonthChange(shiftMonth(visibleMonth, 1))}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: pressed ? c.fill : 'transparent' },
            ]}
          >
            <ChevronRight color={c.label} size={20} />
          </Pressable>
          {onClose ? (
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: pressed ? c.fill : 'transparent' },
              ]}
            >
              <X color={c.secondaryLabel} size={19} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((weekday, index) => (
          <Text
            key={weekday}
            style={[
              styles.weekday,
              t.caption,
              { color: index > 4 ? c.orange : c.secondaryLabel },
            ]}
          >
            {weekday}
          </Text>
        ))}
      </View>

      <View style={styles.daysGrid}>
        {days.map((day) => {
          const value = dateStr(day);
          const selected = value === selectedDate;
          const isToday = value === todayStr();
          const disabled = Boolean(minimumDate && value < minimumDate);
          const outside = day.getMonth() !== visibleMonth.getMonth();
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          const marker = markers.get(value);
          const markerLabel = [
            marker?.menuCount ? `已有${marker.menuCount}道菜` : '',
            marker?.eventCount ? `有${marker.eventCount}个家庭事件` : '',
            marker?.taskCount ? `有${marker.taskCount}个家庭任务` : '',
          ]
            .filter(Boolean)
            .join('，');

          return (
            <View key={value} style={styles.dayCell}>
              <Pressable
                accessibilityLabel={`选择${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日${markerLabel ? `，${markerLabel}` : ''}`}
                accessibilityRole="button"
                accessibilityState={{ disabled, selected }}
                disabled={disabled}
                onPress={() => onSelect(value)}
                style={({ pressed }) => [
                  styles.dayButton,
                  isToday && !selected && {
                    borderColor: c.tint,
                    borderWidth: 1,
                  },
                  selected && { backgroundColor: c.tint },
                  pressed && !selected && { backgroundColor: c.fill },
                ]}
              >
                <Text
                  style={[
                    t.subhead,
                    {
                      color: selected
                        ? '#FFFFFF'
                        : disabled || outside
                          ? c.tertiaryLabel
                          : weekend
                            ? c.orange
                            : c.label,
                      fontWeight: selected || isToday ? '700' : '400',
                    },
                  ]}
                >
                  {day.getDate()}
                </Text>
                {marker?.eventCount ? (
                  <View
                    style={[
                      styles.eventDot,
                      { backgroundColor: selected ? '#FFFFFF' : c.tint },
                    ]}
                  />
                ) : null}
                {marker?.menuCount ? (
                  <View
                    style={[
                      styles.menuBadge,
                      {
                        backgroundColor: selected ? '#FFFFFF' : c.orange,
                        borderColor: c.card,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.menuBadgeText,
                        { color: selected ? c.tint : '#FFFFFF' },
                      ]}
                    >
                      {marker.menuCount > 9 ? '9+' : marker.menuCount}
                    </Text>
                  </View>
                ) : null}
                {marker?.taskCount ? (
                  <View
                    style={[
                      styles.taskDot,
                      { backgroundColor: selected ? '#FFFFFF' : c.blue },
                    ]}
                  />
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: { flexDirection: 'row', marginTop: 12, marginBottom: 4 },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontWeight: '600' },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    height: 43,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventDot: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  menuBadge: {
    position: 'absolute',
    right: -3,
    bottom: -2,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBadgeText: { fontSize: 8, lineHeight: 10, fontWeight: '800' },
  taskDot: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 6,
    height: 6,
    borderRadius: 2,
  },
});
