import { YStack, Text } from 'tamagui';

/** Placeholder — real sign-up lands in the next session. */
export default function SignUp() {
  return (
    <YStack flex={1} bg="$background" ai="center" jc="center" gap="$2" p="$4">
      <Text fontSize="$9" fontWeight="700" color="$color">
        Sign up
      </Text>
      <Text fontSize="$4" color="$placeholderColor">
        Create your polly trade journal
      </Text>
    </YStack>
  );
}
