package cn.jiuzhang.platform.shared.application;

/** Safe public error codes; external exception messages never cross the transport boundary. */
public final class Failure extends RuntimeException {
    public final String code;
    public final int status;
    public Failure(int status, String code) { super(code); this.status = status; this.code = code; }
    public static void require(boolean valid, String code) { if (!valid) throw new Failure(422, code); }
}
