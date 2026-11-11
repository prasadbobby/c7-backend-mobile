/**
 * Weekly Leaderboard Utilities
 * Handles week-based calculations for challenge participants
 * Uses Indian Standard Time (IST) for week calculations
 */

export interface WeekInfo {
  weekNumber: number;
  startDate: Date;
  endDate: Date;
  isCurrentWeek: boolean;
  isCompleted: boolean;
}

export interface WeeklyMetrics {
  totalPosts: number;
  totalEligibleDays: number;
  totalWeekDays: number;
  weekProgress: number;
  consistency: number;
  avgSleepHours: number;
  avgSleepQuality: number;
  avgMood: number;
  avgEnergy: number;
  photoScore: number;
}

/**
 * Convert a date to Indian Standard Time (IST)
 */
function toIST(date: Date): Date {
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  return new Date(date.getTime() + istOffset);
}

/**
 * Get current time in IST
 */
function getCurrentIST(): Date {
  return toIST(new Date());
}

/**
 * Get the start of week (Monday) for a given date in IST
 */
export function getWeekStart(date: Date): Date {
  // Convert to IST first
  const istDate = toIST(date);
  const day = istDate.getUTCDay(); // Use UTC methods since we've already adjusted for IST
  const diff = istDate.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  const monday = new Date(istDate);
  monday.setUTCDate(diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

/**
 * Get the end of week (Sunday 11:59 PM IST) for a given date
 */
export function getWeekEnd(date: Date): Date {
  const weekStart = getWeekStart(date);
  const sunday = new Date(weekStart);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return sunday;
}

/**
 * Get all weeks for a challenge period
 */
export function getChallengeWeeks(challengeStartDate: string, challengeEndDate?: string): WeekInfo[] {
  const startDate = new Date(challengeStartDate);
  const endDate = challengeEndDate ? new Date(challengeEndDate) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const nowIST = getCurrentIST(); // Use IST for current time

  const weeks: WeekInfo[] = [];
  let currentWeekStart = getWeekStart(startDate);
  let weekNumber = 1;

  while (currentWeekStart <= endDate) {
    const currentWeekEnd = getWeekEnd(currentWeekStart);
    const isCurrentWeek = nowIST >= currentWeekStart && nowIST <= currentWeekEnd;
    const isCompleted = nowIST > currentWeekEnd;

    weeks.push({
      weekNumber,
      startDate: new Date(currentWeekStart),
      endDate: new Date(currentWeekEnd),
      isCurrentWeek,
      isCompleted
    });

    // Move to next week
    currentWeekStart = new Date(currentWeekStart);
    currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() + 7);
    weekNumber++;
  }

  return weeks;
}

/**
 * Get the current week info for a challenge
 */
export function getCurrentWeek(challengeStartDate: string): WeekInfo | null {
  const weeks = getChallengeWeeks(challengeStartDate);
  return weeks.find(week => week.isCurrentWeek) || null;
}

/**
 * Get the most recently completed week
 */
export function getLastCompletedWeek(challengeStartDate: string): WeekInfo | null {
  const weeks = getChallengeWeeks(challengeStartDate);
  const completedWeeks = weeks.filter(week => week.isCompleted);
  return completedWeeks.length > 0 ? completedWeeks[completedWeeks.length - 1] : null;
}

/**
 * Filter posts by week
 */
export function getPostsForWeek(posts: any[], week: WeekInfo): any[] {
  return posts.filter(post => {
    const postDate = new Date(post.date);
    return postDate >= week.startDate && postDate <= week.endDate;
  });
}

/**
 * Calculate weekly metrics for a participant
 */
export function calculateWeeklyMetrics(posts: any[], week: WeekInfo, participantJoinedAt: string): WeeklyMetrics {
  const weekPosts = getPostsForWeek(posts, week);
  const joinedDate = new Date(participantJoinedAt);

  // Only count days after the participant joined
  const effectiveStartDate = joinedDate > week.startDate ? joinedDate : week.startDate;

  // For current week, use current date. For completed weeks, use week end date.
  const now = getCurrentIST();
  const isCurrentWeek = now >= week.startDate && now <= week.endDate;
  const effectiveEndDate = isCurrentWeek ? now : week.endDate;

  // Calculate days the participant was eligible to post this week
  const daysDiff = Math.ceil((effectiveEndDate.getTime() - effectiveStartDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsedThisWeek = Math.max(1, daysDiff);

  // Calculate current week progress (for display)
  const weekProgress = isCurrentWeek
    ? Math.ceil((now.getTime() - week.startDate.getTime()) / (1000 * 60 * 60 * 24))
    : 7; // Completed weeks show 7/7

  // For display purposes, always show X/7 days (full week)
  // But for scoring, use actual eligible days based on when they joined
  const totalEligibleDays = daysElapsedThisWeek;
  const totalWeekDays = 7;

  const totalPosts = weekPosts.length;
  const consistency = totalEligibleDays > 0 ? (totalPosts / totalEligibleDays) * 100 : 0;

  // Calculate totals accounting for missed days (missed days = 0 for all metrics)
  const totalSleepHours = weekPosts.reduce((total, p) => {
    const hours = (p.sleepHours !== null && typeof p.sleepHours === 'number' && !isNaN(p.sleepHours) && p.sleepHours >= 0 && p.sleepHours <= 24)
      ? p.sleepHours
      : 0;
    return total + hours;
  }, 0);

  const totalSleepQuality = weekPosts.reduce((total, p) => {
    const qualityMap = { 'POOR': 1, 'FAIR': 2, 'GOOD': 3, 'VERY_GOOD': 4, 'EXCELLENT': 5 };
    const score = p.sleepQuality ? (qualityMap[p.sleepQuality as keyof typeof qualityMap] || 0) : 0;
    return total + score;
  }, 0);

  const totalMood = weekPosts.reduce((total, p) => {
    const moodMap = { 'VERY_LOW': 0, 'LOW': 1, 'NEUTRAL': 2, 'GOOD': 3, 'VERY_GOOD': 4, 'EXCELLENT': 5 };
    const score = p.mood ? (moodMap[p.mood as keyof typeof moodMap] || 0) : 0;
    return total + score;
  }, 0);

  const totalEnergy = weekPosts.reduce((total, p) => {
    const energyMap = { 'VERY_LOW': 1, 'LOW': 2, 'MODERATE': 3, 'HIGH': 4, 'VERY_HIGH': 5 };
    const score = p.energy ? (energyMap[p.energy as keyof typeof energyMap] || 1) : 1; // VERY_LOW = 1 minimum
    return total + score;
  }, 0);

  // Calculate photo scores accounting for missed days
  const totalPhotoPoints = weekPosts.reduce((total, post) => {
    // Support both old format (photos array) and new format (photoCount)
    const photoCount = (post as any).photoCount !== undefined
      ? (post as any).photoCount
      : ((post.photos && Array.isArray(post.photos)) ? post.photos.length : 0);

    const isFasting = post.isFasting || false;

    // If fasting, award full 3 points regardless of photo count
    if (isFasting) {
      return total + 3;
    }

    // Same logic as overall scoring: 0 photos = 0, 1-3 photos = photo count, 4+ photos = 3
    let points = 0;
    if (photoCount === 0) {
      points = 0;
    } else if (photoCount >= 1 && photoCount <= 3) {
      points = photoCount;
    } else {
      points = 3; // Cap at 3 points for 4+ photos
    }

    return total + points;
  }, 0);

  // Average photo score across all eligible days (including missed days as 0)
  const photoScore = totalEligibleDays > 0 ? totalPhotoPoints / totalEligibleDays : 0;

  return {
    totalPosts,
    totalEligibleDays,
    totalWeekDays,
    weekProgress,
    consistency: Math.min(100, consistency),
    avgSleepHours: totalEligibleDays > 0 ? totalSleepHours / totalEligibleDays : 0,
    avgSleepQuality: totalEligibleDays > 0 ? totalSleepQuality / totalEligibleDays : 0,
    avgMood: totalEligibleDays > 0 ? totalMood / totalEligibleDays : 0,
    avgEnergy: totalEligibleDays > 0 ? totalEnergy / totalEligibleDays : 0,
    photoScore: photoScore,
  };
}

/**
 * Calculate weekly score using unified scoring system (same as overall leaderboard)
 */
export function calculateWeeklyScore(metrics: ReturnType<typeof calculateWeeklyMetrics>) {
  // Use the same weights as overall scoring for consistency
  const weights = {
    consistency: 0.25,       // Updated to match overall (25%)
    avgSleepHours: 0.18,     // Updated to match overall (18%)
    avgSleepQuality: 0.15,   // Same as overall (15%)
    avgMood: 0.12,           // Updated to match overall (12%)
    avgEnergy: 0.12,         // Updated to match overall (12%)
    photoScore: 0.10,        // NEW: Photo uploads (10%)
    totalPosts: 0.08         // Updated to match overall (8%)
  };

  // Normalize metrics using the same approach as overall scoring
  const normalizedConsistency = Math.min(100, metrics.consistency) / 100;
  const normalizedSleepHours = Math.min(12, Math.max(0, metrics.avgSleepHours)) / 12; // Same as overall
  const normalizedSleepQuality = metrics.avgSleepQuality / 5;
  const normalizedMood = metrics.avgMood / 5;
  const normalizedEnergy = metrics.avgEnergy / 5;
  const normalizedPhotoScore = metrics.photoScore / 3; // Normalize to max score of 3
  const normalizedTotalPosts = Math.min(metrics.totalEligibleDays, metrics.totalPosts) / metrics.totalEligibleDays;

  const score =
    (normalizedConsistency * weights.consistency * 100) +
    (normalizedSleepHours * weights.avgSleepHours * 100) +
    (normalizedSleepQuality * weights.avgSleepQuality * 100) +
    (normalizedMood * weights.avgMood * 100) +
    (normalizedEnergy * weights.avgEnergy * 100) +
    (normalizedPhotoScore * weights.photoScore * 100) +
    (normalizedTotalPosts * weights.totalPosts * 100);

  return Math.round(score);
}

/**
 * Format week display text
 */
export function formatWeekDisplay(week: WeekInfo): string {
  const startMonth = week.startDate.toLocaleDateString('en-US', { month: 'short' });
  const startDay = week.startDate.getDate();
  const endMonth = week.endDate.toLocaleDateString('en-US', { month: 'short' });
  const endDay = week.endDate.getDate();

  if (startMonth === endMonth) {
    return `Week ${week.weekNumber}: ${startMonth} ${startDay}-${endDay}`;
  } else {
    return `Week ${week.weekNumber}: ${startMonth} ${startDay} - ${endMonth} ${endDay}`;
  }
}