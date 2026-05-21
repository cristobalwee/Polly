import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Input, Label, Text, YStack } from 'tamagui';

type FormFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: Path<T>;
  label: string;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  keyboardType?: 'default' | 'email-address';
  multiline?: boolean;
};

/**
 * A labelled text input wired to React Hook Form.
 *
 * `Controller` bridges Tamagui's `Input` (uncontrolled-friendly but not a
 * native form control) to RHF, and the field's validation error renders
 * underneath. Used by every form in the app.
 */
export function FormField<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  secureTextEntry,
  autoCapitalize = 'sentences',
  keyboardType = 'default',
  multiline = false,
}: FormFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
        <YStack gap="$1.5">
          <Label htmlFor={name} fontSize="$3" color="$placeholderColor">
            {label}
          </Label>
          <Input
            id={name}
            value={value ?? ''}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder={placeholder}
            secureTextEntry={secureTextEntry}
            autoCapitalize={autoCapitalize}
            keyboardType={keyboardType}
            multiline={multiline}
            numberOfLines={multiline ? 5 : 1}
            borderColor={error ? '$red10' : '$borderColor'}
          />
          {error?.message ? (
            <Text fontSize="$2" color="$red10">
              {error.message}
            </Text>
          ) : null}
        </YStack>
      )}
    />
  );
}
