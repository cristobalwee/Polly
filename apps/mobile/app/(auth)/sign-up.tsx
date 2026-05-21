import { useState } from 'react';
import { Link } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button, H1, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui';
import { z } from 'zod';
import { FormField } from '../../components/FormField';
import { useAuthActions } from '../../hooks/useAuthActions';

const SignUpSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
});
type SignUpValues = z.infer<typeof SignUpSchema>;

/** Create a polly account with email + password. */
export default function SignUp() {
  const { signUp } = useAuthActions();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<SignUpValues>({
    resolver: zodResolver(SignUpSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async ({ name, email, password }) => {
    setSubmitError(null);
    try {
      await signUp(name, email, password);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create your account.');
    }
  });

  return (
    <YStack flex={1} bg="$background" jc="center" p="$5" gap="$5">
      <YStack gap="$2">
        <H1 fontSize="$10" fontWeight="800" color="$accent">
          polly
        </H1>
        <Paragraph fontSize="$5" fontWeight="600" color="$color">
          Create your account
        </Paragraph>
        <Paragraph fontSize="$3" color="$placeholderColor">
          Start journaling your prediction-market trades.
        </Paragraph>
      </YStack>

      <YStack gap="$3">
        <FormField
          control={control}
          name="name"
          label="Name"
          placeholder="Your name"
        />
        <FormField
          control={control}
          name="email"
          label="Email"
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <FormField
          control={control}
          name="password"
          label="Password"
          placeholder="At least 8 characters"
          autoCapitalize="none"
          secureTextEntry
        />

        {submitError ? (
          <Text fontSize="$3" color="$red10">
            {submitError}
          </Text>
        ) : null}

        <Button
          bg="$accent"
          disabled={formState.isSubmitting}
          opacity={formState.isSubmitting ? 0.6 : 1}
          onPress={onSubmit}
          icon={formState.isSubmitting ? <Spinner color="white" /> : undefined}
        >
          <Button.Text color="white" fontWeight="700">
            {formState.isSubmitting ? 'Creating account…' : 'Sign up'}
          </Button.Text>
        </Button>
      </YStack>

      <XStack jc="center" gap="$2">
        <Text fontSize="$3" color="$placeholderColor">
          Already have an account?
        </Text>
        <Link href="/sign-in" replace>
          <Text fontSize="$3" fontWeight="700" color="$accent">
            Sign in
          </Text>
        </Link>
      </XStack>
    </YStack>
  );
}
