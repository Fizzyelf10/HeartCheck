package com.example.heart.validation;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.RECORD_COMPONENT;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;
import java.util.Arrays;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;

/** The annotated Integer must be one of the listed codes ({@code null} is valid). */
@Documented
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, RECORD_COMPONENT})
@Constraint(validatedBy = OneOf.Validator.class)
public @interface OneOf {
    int[] value();

    String message() default "must be one of {value}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<OneOf, Integer> {
        private int[] allowed;

        @Override
        public void initialize(OneOf annotation) {
            allowed = annotation.value();
        }

        @Override
        public boolean isValid(Integer value, ConstraintValidatorContext ctx) {
            return value == null || Arrays.stream(allowed).anyMatch(a -> a == value);
        }
    }
}
