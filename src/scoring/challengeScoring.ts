/**
 * Unified Challenge Scoring System
 *
 * This utility provides consistent scoring across the leaderboard and participant details.
 * All scoring calculations should use these functions to ensure consistency.
 */

export interface ChallengeMetrics {
  totalPosts: number;
  avgSleepHours: number;
  avgSleepQuality: number;
  avgMood: number;
  avgEnergy: number;
  photoScore: number;
  consistency: number;
}

export interface ScoringWeights {
  consistency: number;
  avgSleepHours: number;
  avgSleepQuality: number;
  avgMood: number;
  avgEnergy: number;
  photoScore: number;
  totalPosts: number;
}

// Standardized scoring weights - single source of truth
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  consistency: 0.25,     // 25% - Most important (posting regularly)
  avgSleepHours: 0.18,   // 18% - Sleep quantity
  avgSleepQuality: 0.15, // 15% - Sleep quality
  avgMood: 0.12,         // 12% - Mental wellness
  avgEnergy: 0.12,       // 12% - Physical wellness
  photoScore: 0.10,      // 10% - Photo uploads (transformation tracking)
  totalPosts: 0.08       // 8% - Engagement bonus
};

/**
 * Convert sleep quality enum to numeric score
 */
export function getSleepQualityScore(quality: string): number {
  const scores: Record<string, number> = {
    'EXCELLENT': 5,
    'VERY_GOOD': 4,
    'GOOD': 3,
    'FAIR': 2,
    'POOR': 1
  };
  return scores[quality] || 0;
}

/**
 * Convert mood enum to numeric score
 */
export function getMoodScore(mood: string): number {
  const scores: Record<string, number> = {
    'EXCELLENT': 5,
    'VERY_GOOD': 4,
    'GOOD': 3,
    'NEUTRAL': 2,
    'LOW': 1,
    'VERY_LOW': 0
  };
  return scores[mood] || 0;
}

/**
 * Convert energy enum to numeric score
 */
export function getEnergyScore(energy: string): number {
  const scores: Record<string, number> = {
    'VERY_HIGH': 5,
    'HIGH': 4,
    'MODERATE': 3,
    'LOW': 2,
    'VERY_LOW': 1
  };
  return scores[energy] || 0;
}

/**
 * Calculate photo score based on number of photos uploaded and fasting status
 * Optimal is 1-3 photos per post. 4-5+ photos still count as max 3 for points.
 * If fasting is true, always return 3 points regardless of photo count.
 */
export function getPhotoScore(photoCount: number, isFasting: boolean = false): number {
  if (isFasting) return 3; // Full points for fasting
  if (photoCount === 0) return 0;
  if (photoCount >= 1 && photoCount <= 3) return photoCount; // 1, 2, or 3 points
  return 3; // Cap at 3 points for 4+ photos
}

/**
 * Calculate normalized metrics for scoring
 */
export function normalizeMetrics(metrics: ChallengeMetrics, daysElapsed: number): Record<keyof ScoringWeights, number> {
  return {
    consistency: Math.min(100, metrics.consistency) / 100,
    avgSleepHours: Math.min(12, Math.max(0, metrics.avgSleepHours)) / 12,
    avgSleepQuality: metrics.avgSleepQuality / 5,
    avgMood: metrics.avgMood / 5,
    avgEnergy: metrics.avgEnergy / 5,
    photoScore: metrics.photoScore / 3, // Normalize to max score of 3
    totalPosts: Math.min(daysElapsed, metrics.totalPosts) / daysElapsed
  };
}

/**
 * Calculate overall challenge score using standardized weights
 */
export function calculateChallengeScore(
  metrics: ChallengeMetrics,
  daysElapsed: number,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS
): number {
  const normalizedMetrics = normalizeMetrics(metrics, daysElapsed);

  return Object.entries(weights).reduce((score, [key, weight]) => {
    const metricValue = normalizedMetrics[key as keyof typeof normalizedMetrics];
    return score + (metricValue * weight * 100);
  }, 0);
}

/**
 * Calculate consistency percentage based on posts and elapsed time
 */
export function calculateConsistency(totalPosts: number, daysElapsed: number): number {
  return Math.min(100, (totalPosts / daysElapsed) * 100);
}

/**
 * Calculate average sleep quality from posts
 * IMPORTANT: This only averages existing posts - missed days are handled by consistency scoring
 */
export function calculateAverageSleepQuality(posts: Array<{ sleepQuality: string | null }>): number {
  const sleepQualityScores = posts
    .filter(p => p.sleepQuality !== null && typeof p.sleepQuality === 'string')
    .map(p => getSleepQualityScore(p.sleepQuality!))
    .filter(score => !isNaN(score) && score >= 0);

  return sleepQualityScores.length > 0
    ? sleepQualityScores.reduce((sum, score) => sum + score, 0) / sleepQualityScores.length
    : 0;
}

/**
 * Calculate sleep quality accounting for missed days
 * Missed days count as 0 (worst possible sleep quality)
 */
export function calculateSleepQualityWithMissedDays(
  posts: Array<{ sleepQuality: string | null }>,
  daysElapsed: number
): number {
  const totalSleepQualityScore = posts.reduce((total, post) => {
    const score = (post.sleepQuality !== null && typeof post.sleepQuality === 'string')
      ? getSleepQualityScore(post.sleepQuality)
      : 0;
    return total + score;
  }, 0);

  return daysElapsed > 0 ? totalSleepQualityScore / daysElapsed : 0;
}

/**
 * Calculate average mood from posts
 * IMPORTANT: This only averages existing posts - missed days are handled by consistency scoring
 */
export function calculateAverageMood(posts: Array<{ mood: string | null }>): number {
  const moodScores = posts
    .filter(p => p.mood !== null && typeof p.mood === 'string')
    .map(p => getMoodScore(p.mood!))
    .filter(score => !isNaN(score) && score >= 0);

  return moodScores.length > 0
    ? moodScores.reduce((sum, score) => sum + score, 0) / moodScores.length
    : 0;
}

/**
 * Calculate mood accounting for missed days
 * Missed days count as 0 (VERY_LOW mood)
 */
export function calculateMoodWithMissedDays(
  posts: Array<{ mood: string | null }>,
  daysElapsed: number
): number {
  const totalMoodScore = posts.reduce((total, post) => {
    const score = (post.mood !== null && typeof post.mood === 'string')
      ? getMoodScore(post.mood)
      : 0;
    return total + score;
  }, 0);

  return daysElapsed > 0 ? totalMoodScore / daysElapsed : 0;
}

/**
 * Calculate average energy from posts
 * IMPORTANT: This only averages existing posts - missed days are handled by consistency scoring
 */
export function calculateAverageEnergy(posts: Array<{ energy: string | null }>): number {
  const energyScores = posts
    .filter(p => p.energy !== null && typeof p.energy === 'string')
    .map(p => getEnergyScore(p.energy!))
    .filter(score => !isNaN(score) && score >= 0);

  return energyScores.length > 0
    ? energyScores.reduce((sum, score) => sum + score, 0) / energyScores.length
    : 0;
}

/**
 * Calculate energy accounting for missed days
 * Missed days count as 1 (VERY_LOW energy)
 */
export function calculateEnergyWithMissedDays(
  posts: Array<{ energy: string | null }>,
  daysElapsed: number
): number {
  const totalEnergyScore = posts.reduce((total, post) => {
    const score = (post.energy !== null && typeof post.energy === 'string')
      ? getEnergyScore(post.energy)
      : 1; // VERY_LOW energy = 1 (not 0, as 0 would be invalid)
    return total + score;
  }, 0);

  return daysElapsed > 0 ? totalEnergyScore / daysElapsed : 0;
}

/**
 * Calculate average sleep hours from posts
 * IMPORTANT: This only averages existing posts - missed days are handled by consistency scoring
 */
export function calculateAverageSleepHours(posts: Array<{ sleepHours: number | null }>): number {
  const sleepHours = posts
    .filter(p => p.sleepHours !== null && typeof p.sleepHours === 'number' && !isNaN(p.sleepHours) && p.sleepHours >= 0 && p.sleepHours <= 24)
    .map(p => p.sleepHours!);

  return sleepHours.length > 0
    ? sleepHours.reduce((sum, hours) => sum + hours, 0) / sleepHours.length
    : 0;
}

/**
 * Calculate sleep hours accounting for missed days
 * Missed days count as 0 sleep hours, providing proper penalty
 */
export function calculateSleepHoursWithMissedDays(
  posts: Array<{ sleepHours: number | null }>,
  daysElapsed: number
): number {
  const totalSleepHours = posts.reduce((total, post) => {
    const hours = (post.sleepHours !== null && typeof post.sleepHours === 'number' && !isNaN(post.sleepHours) && post.sleepHours >= 0 && post.sleepHours <= 24)
      ? post.sleepHours
      : 0;
    return total + hours;
  }, 0);

  return daysElapsed > 0 ? totalSleepHours / daysElapsed : 0;
}

/**
 * Calculate average photo score from posts
 * Each post gets a score based on photos: 0 photos = 0, 1-3 photos = photo count, 4+ photos = 3
 * If fasting is true, post gets full 3 points regardless of photo count
 * IMPORTANT: This only averages existing posts - missed days are handled by consistency scoring
 */
export function calculateAveragePhotoScore(posts: Array<{ photos: string[] | null; isFasting?: boolean | null }>): number {
  const photoScores = posts.map((p) => {
    const photoCount = (p.photos && Array.isArray(p.photos)) ? p.photos.length : 0;
    const isFasting = p.isFasting || false;
    const score = getPhotoScore(photoCount, isFasting);
    return score;
  });

  const average = photoScores.length > 0
    ? photoScores.reduce((sum, score) => sum + score, 0) / photoScores.length
    : 0;

  return average;
}

/**
 * Calculate photo score accounting for missed days
 * This gives a more accurate representation by considering all eligible days
 * If fasting is true, post gets full 3 points regardless of photo count
 */
export function calculatePhotoScoreWithMissedDays(
  posts: Array<{ photos?: string[] | null; photoCount?: number; isFasting?: boolean | null }>,
  daysElapsed: number
): number {
  // Calculate total photo points from all posts
  const totalPhotoPoints = posts.reduce((total, post) => {
    // Support both old format (photos array) and new format (photoCount)
    const photoCount = post.photoCount !== undefined
      ? post.photoCount
      : ((post.photos && Array.isArray(post.photos)) ? post.photos.length : 0);

    const isFasting = post.isFasting || false;
    const score = getPhotoScore(photoCount, isFasting);
    return total + score;
  }, 0);

  // Average across all eligible days (including missed days as 0)
  const finalScore = daysElapsed > 0 ? totalPhotoPoints / daysElapsed : 0;
  return finalScore;
}

/**
 * Calculate all metrics for a participant from their posts
 */
export function calculateParticipantMetrics(
  posts: Array<{
    sleepHours: number | null;
    sleepQuality: string | null;
    mood: string | null;
    energy: string | null;
    photos: string[] | null;
    isFasting?: boolean | null;
    createdAt: string;
  }>,
  joinedAt: string
): ChallengeMetrics {
  const totalPosts = posts.length;

  // Use UTC dates for consistency
  const now = new Date();
  const nowUTC = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const joinedAtUTC = new Date(new Date(joinedAt).getUTCFullYear(), new Date(joinedAt).getUTCMonth(), new Date(joinedAt).getUTCDate());

  const daysElapsed = Math.max(1, Math.ceil((nowUTC.getTime() - joinedAtUTC.getTime()) / (1000 * 60 * 60 * 24)));

  const photoScore = calculatePhotoScoreWithMissedDays(posts, daysElapsed);

  const metrics = {
    totalPosts,
    avgSleepHours: calculateSleepHoursWithMissedDays(posts, daysElapsed),
    avgSleepQuality: calculateSleepQualityWithMissedDays(posts, daysElapsed),
    avgMood: calculateMoodWithMissedDays(posts, daysElapsed),
    avgEnergy: calculateEnergyWithMissedDays(posts, daysElapsed),
    photoScore,
    consistency: calculateConsistency(totalPosts, daysElapsed)
  };

  return metrics;
}