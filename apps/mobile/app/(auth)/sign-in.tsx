import { useState } from 'react';
import { Link } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button, H1, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui';
import { z } from 'zod';
import { FormField } from '../../components/FormField';
import { useAuthActions } from '../../hooks/useAuthActions';

const SignInSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type SignInValues = z.infer<typeof SignInSchema>;

/** Email/password sign-in. */
export default function SignIn() {
  const { signIn } = useAuthActions();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<SignInValues>({
    resolver: zodResolver(SignInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setSubmitError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not sign in.');
    }
  });

  return (
    <YStack flex={1} bg="$background" jc="center" p="$5" gap="$5">
      <YStack gap="$2">
        <H1 fontSize="$10" fontWeight="800" color="$accent">
          polly
        </H1>
        <Paragraph fontSize="$5" fontWeight="600" color="$color">
          Sign in
        </Paragraph>
        <Paragraph fontSize="$3" color="$placeholderColor">
          Welcome back to your trade journal.
        </Paragraph>
      </YStack>

      <YStack gap="$3">
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
          placeholder="Your password"
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
            {formState.isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button.Text>
        </Button>
      </YStack>

      <XStack jc="center" gap="$2">
        <Text fontSize="$3" color="$placeholderColor">
          New to polly?
        </Text>
        <Link href="/sign-up" replace>
          <Text fontSize="$3" fontWeight="700" color="$accent">
            Create an account
          </Text>
        </Link>
      </XStack>
    </YStack>
  );
}
