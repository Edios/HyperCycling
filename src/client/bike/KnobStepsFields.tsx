import { KNOB_STEP_COUNT } from '../../domain/bike';
import { useT } from '../i18n';
import { Field } from '../ui/Field';
import styles from './Bike.module.css';

/** Five inputs for the knob position of S1..S5 (values are raw text so typing stays free). */
export function KnobStepsFields({
  values,
  onChange,
  invalid,
}: {
  values: readonly string[];
  onChange: (next: string[]) => void;
  invalid: boolean;
}) {
  const t = useT();
  return (
    <div className={styles.steps} data-testid="knob-steps">
      {Array.from({ length: KNOB_STEP_COUNT }, (_, i) => (
        <Field key={i} label={t('bike.stepLabel', { n: i + 1 })}>
          {(id) => (
            <input
              id={id}
              inputMode="numeric"
              value={values[i] ?? ''}
              aria-invalid={invalid}
              onChange={(e) => onChange(values.map((v, j) => (j === i ? e.target.value : v)))}
            />
          )}
        </Field>
      ))}
      {invalid && (
        <small role="alert" className={styles.error}>
          {t('bike.stepsInvalid')}
        </small>
      )}
    </div>
  );
}
