import { YStack, Text } from 'tamagui';

/** Placeholder — real sign-in lands in the next session. */
export default function SignIn() {
  return (
    <YStack flex={1} bg="$background" ai="center" jc="center" gap="$2" p="$4">
      <Text fontSize="$9" fontWeight="700" color="$color">
        Sign in
      </Text>
      <Text fontSize="$4" color="$placeholderColor">
        Connect your Kalshi account to polly
      </Text>
    </YStack>
  );
}
