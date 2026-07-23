import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no ResizeObserver, which the radix Slider in the crop view needs.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

const mocks = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  uploadMutate: vi.fn(),
  updateSession: vi.fn(),
  createCroppedAvatarFile: vi.fn(),
  profile: {
    email: "user@example.com",
    name: "MKYN",
    avatarPreset: "lumen",
    avatarUrl: null
  }
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        email: "user@example.com",
        name: "MKYN",
        avatarPreset: "lumen",
        image: null
      }
    },
    update: mocks.updateSession
  })
}));

vi.mock("@/lib/hooks/use-user-profile", () => ({
  useUserProfile: () => ({ data: mocks.profile, isPending: false }),
  useUpdateUserProfile: () => ({
    mutateAsync: mocks.updateMutate,
    isPending: false
  }),
  useUploadUserAvatar: () => ({
    mutateAsync: mocks.uploadMutate,
    isPending: false
  })
}));

vi.mock("react-easy-crop", () => ({
  default: (props: {
    onCropComplete?: (area: unknown, pixels: unknown) => void;
  }) => {
    queueMicrotask(() =>
      props.onCropComplete?.({}, { x: 0, y: 0, width: 200, height: 200 })
    );
    return <div data-testid="cropper" />;
  }
}));

vi.mock("@/lib/avatar-crop", () => ({
  createCroppedAvatarFile: mocks.createCroppedAvatarFile
}));

import { ProfileDialog } from "@/components/user/profile-dialog";

function renderDialog(onOpenChange = vi.fn()) {
  const utils = render(<ProfileDialog open onOpenChange={onOpenChange} />);
  return { onOpenChange, ...utils };
}

function fileInput() {
  // DialogContent renders through a portal, so the file input lives in
  // document.body rather than the render container.
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input;
}

function oversizedFile() {
  const file = new File(["x"], "big.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: 21 * 1024 * 1024 });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMutate.mockResolvedValue(mocks.profile);
  mocks.uploadMutate.mockResolvedValue(mocks.profile);
  mocks.createCroppedAvatarFile.mockResolvedValue(
    new File(["x"], "avatar.webp", { type: "image/webp" })
  );
});

describe("ProfileDialog", () => {
  it("shows nickname, email and disables save until the nickname changes", () => {
    renderDialog();
    expect(screen.getByDisplayValue("MKYN")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("exposes a clear header close action", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "关闭个人资料" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves the trimmed nickname and closes on success", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText("昵称"), {
      target: { value: "  新昵称  " }
    });
    const saveButton = screen.getByRole("button", { name: "保存" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(mocks.updateMutate).toHaveBeenCalledWith({ name: "新昵称" });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("rejects unsupported file types before cropping", () => {
    renderDialog();
    fireEvent.change(fileInput(), {
      target: {
        files: [new File(["x"], "a.gif", { type: "image/gif" })]
      }
    });
    expect(
      screen.getByText("仅支持 JPG、PNG 或 WebP 头像")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("cropper")).not.toBeInTheDocument();
  });

  it("rejects files larger than 20MB", () => {
    renderDialog();
    fireEvent.change(fileInput(), {
      target: { files: [oversizedFile()] }
    });
    expect(screen.getByText("头像不能超过 20MB")).toBeInTheDocument();
  });

  it("opens the cropper for a valid image and uploads the cropped file on confirm", async () => {
    renderDialog();
    fireEvent.change(fileInput(), {
      target: {
        files: [new File(["x"], "photo.png", { type: "image/png" })]
      }
    });
    expect(await screen.findByTestId("cropper")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => {
      expect(mocks.createCroppedAvatarFile).toHaveBeenCalledWith(
        expect.stringContaining("data:"),
        { x: 0, y: 0, width: 200, height: 200 }
      );
    });
    await waitFor(() => {
      expect(mocks.uploadMutate).toHaveBeenCalledWith(
        expect.objectContaining({ type: "image/webp" })
      );
    });
    expect(mocks.updateSession).toHaveBeenCalled();
  });

  it("turns the primary button into an enabled 完成 after an avatar-only change", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.change(fileInput(), {
      target: {
        files: [new File(["x"], "photo.png", { type: "image/png" })]
      }
    });
    expect(await screen.findByTestId("cropper")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => {
      expect(mocks.uploadMutate).toHaveBeenCalled();
    });
    // Avatar uploaded instantly, nickname untouched: the primary button
    // should offer an enabled "完成" (close) instead of a dead "保存".
    const doneButton = await screen.findByRole("button", { name: "完成" });
    expect(doneButton).toBeEnabled();
    fireEvent.click(doneButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.updateMutate).not.toHaveBeenCalled();
  });

  it("discards the selected file when cancelling the crop", async () => {
    renderDialog();
    fireEvent.change(fileInput(), {
      target: {
        files: [new File(["x"], "photo.png", { type: "image/png" })]
      }
    });
    expect(await screen.findByTestId("cropper")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByTestId("cropper")).not.toBeInTheDocument();
    expect(mocks.uploadMutate).not.toHaveBeenCalled();
  });

  it("shows an error and returns to the main view when the avatar upload fails", async () => {
    mocks.uploadMutate.mockRejectedValue(new Error("网络错误"));
    renderDialog();
    fireEvent.change(fileInput(), {
      target: {
        files: [new File(["x"], "photo.png", { type: "image/png" })]
      }
    });
    expect(await screen.findByTestId("cropper")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(await screen.findByText("网络错误")).toBeInTheDocument();
    expect(screen.queryByTestId("cropper")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and shows an error when saving the nickname fails", async () => {
    mocks.updateMutate.mockRejectedValue(new Error("boom"));
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText("昵称"), {
      target: { value: "新昵称" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("保存失败，请重试")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("resets local state after the dialog is closed", () => {
    const { rerender } = renderDialog();
    fireEvent.change(screen.getByLabelText("昵称"), {
      target: { value: "临时昵称" }
    });
    fireEvent.change(fileInput(), {
      target: {
        files: [new File(["x"], "a.gif", { type: "image/gif" })]
      }
    });
    expect(
      screen.getByText("仅支持 JPG、PNG 或 WebP 头像")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    rerender(<ProfileDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByDisplayValue("MKYN")).toBeInTheDocument();
    expect(
      screen.queryByText("仅支持 JPG、PNG 或 WebP 头像")
    ).not.toBeInTheDocument();
  });

  it("ignores the file result when the dialog closes before the FileReader completes", async () => {
    renderDialog();
    fireEvent.change(fileInput(), {
      target: {
        files: [new File(["x"], "photo.png", { type: "image/png" })]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    // Let the pending FileReader fire its (stale) load event.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.queryByTestId("cropper")).not.toBeInTheDocument();
  });
});
