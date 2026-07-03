import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const LEARNING_IDS = {
  course: 'library.learning.course',
  lesson: 'library.learning.lesson',
  quiz: 'library.learning.quiz'
} as const;

const course = defineBrick({
  id: LEARNING_IDS.course,
  name: 'Course overview',
  category: 'learning',
  surfaceType: 'screen',
  summary: 'Course landing with enroll and resume, idempotent enrollment.',
  description:
    'The course home. Enrolling is blocked when already enrolled; resuming requires enrollment first.',
  surfaceName: 'Course',
  surfaceDescription: 'Introduce a course and let the learner enroll or resume.',
  tags: ['learning', 'course', 'lms', 'enroll'],
  siblings: [{ id: LEARNING_IDS.lesson, label: 'Start lesson' }],
  states: [
    { path: 'course.enrolled', type: 'boolean', default: false, description: 'Whether the learner is enrolled.' },
    { path: 'course.progressPercent', type: 'number', default: 0, description: 'Completion percentage.' },
    { path: 'course.lessonCount', type: 'number', default: 0, description: 'Number of lessons.' }
  ],
  invariants: [
    { name: 'Progress is non-negative', path: 'course.progressPercent', op: 'greater_than', value: -1, message: 'Progress can never be negative.' }
  ],
  actions: [
    {
      name: 'Enroll',
      intent: 'Enroll the learner in the course.',
      emits: 'course.enrolled',
      roles: ['primary'],
      requiredStates: ['course.enrolled'],
      rules: [
        { category: 'business', when: { path: 'course.enrolled', op: 'is_true' }, block: 'You are already enrolled.' },
        { category: 'business', description: 'Mark the learner enrolled.', set: { path: 'course.enrolled', value: true } }
      ]
    },
    {
      name: 'Resume',
      intent: 'Jump back into the course.',
      emits: 'course.resumed',
      roles: ['entry'],
      requiredStates: ['course.enrolled'],
      rules: [
        { category: 'business', when: { path: 'course.enrolled', op: 'is_false' }, block: 'Enroll before starting the course.' }
      ]
    }
  ]
});

const lesson = defineBrick({
  id: LEARNING_IDS.lesson,
  name: 'Lesson',
  category: 'learning',
  surfaceType: 'screen',
  summary: 'Lesson player with progress tracking and completion.',
  description:
    'A single lesson. Progress binds a validated position; marking complete flips the completion flag and emits an event a course tracker can react to.',
  surfaceName: 'Lesson',
  surfaceDescription: 'Play a lesson and track completion.',
  tags: ['learning', 'lesson', 'video', 'progress'],
  siblings: [{ id: LEARNING_IDS.quiz, label: 'Take quiz' }],
  states: [
    { path: 'lesson.completed', type: 'boolean', default: false, description: 'Whether the lesson is finished.' },
    { path: 'lesson.positionSec', type: 'number', default: 0, description: 'Playhead position in seconds.' }
  ],
  invariants: [
    { name: 'Position is non-negative', path: 'lesson.positionSec', op: 'greater_than', value: -1, message: 'Lesson position can never be negative.' }
  ],
  actions: [
    {
      name: 'Update progress',
      intent: 'Record how far the learner has watched.',
      emits: 'lesson.progress.updated',
      roles: ['feedback'],
      params: [
        { name: 'positionSec', type: 'number', description: 'Position in seconds.', bindTo: 'lesson.positionSec', validations: [{ type: 'min', value: 0 }, { type: 'integer' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Progress saved.', tone: 'info' } }]
    },
    {
      name: 'Mark complete',
      intent: 'Mark the lesson as completed.',
      emits: 'lesson.completed',
      roles: ['primary'],
      rules: [{ category: 'business', description: 'Flag the lesson complete.', set: { path: 'lesson.completed', value: true } }]
    }
  ]
});

const quiz = defineBrick({
  id: LEARNING_IDS.quiz,
  name: 'Quiz',
  category: 'learning',
  surfaceType: 'screen',
  summary: 'Graded quiz with a single-submit guard and retry.',
  description:
    'An assessment. Submitting is blocked once answered; retry clears the score and lets the learner try again.',
  surfaceName: 'Quiz',
  surfaceDescription: 'Answer questions and receive a score.',
  tags: ['learning', 'quiz', 'assessment', 'grade'],
  states: [
    { path: 'quiz.score', type: 'number', default: 0, description: 'Score out of 100.' },
    { path: 'quiz.submitted', type: 'boolean', default: false, description: 'Whether the quiz was submitted.' },
    { path: 'quiz.passingScore', type: 'number', default: 70, description: 'Score required to pass.' }
  ],
  invariants: [
    { name: 'Passing score is positive', path: 'quiz.passingScore', op: 'greater_than', value: 0, message: 'The passing score is always positive.' }
  ],
  actions: [
    {
      name: 'Submit answers',
      intent: 'Grade the submitted answers.',
      emits: 'quiz.submitted',
      roles: ['primary'],
      requiredStates: ['quiz.submitted'],
      params: [
        { name: 'correctCount', type: 'number', description: 'Number of correct answers.', validations: [{ type: 'min', value: 0 }, { type: 'integer' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'quiz.submitted', op: 'is_true' }, block: 'You already submitted this quiz.' },
        { category: 'business', description: 'Mark the quiz submitted.', set: { path: 'quiz.submitted', value: true } }
      ]
    },
    {
      name: 'Retry quiz',
      intent: 'Reset the quiz for another attempt.',
      emits: 'quiz.retried',
      roles: ['primary'],
      rules: [{ category: 'business', description: 'Clear the submitted flag.', set: { path: 'quiz.submitted', value: false } }]
    }
  ]
});

export const learningBlueprints: readonly SurfaceBlueprint[] = [course, lesson, quiz];
